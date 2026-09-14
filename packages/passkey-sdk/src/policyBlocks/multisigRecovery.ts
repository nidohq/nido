import type {
  ChainRule, LocalOverlay, MultisigRecoveryBlock,
  PolicyBlockModule, PolicyState, TxBuild,
} from './types.js';
import { registerPolicyBlockModule } from './registry.js';
import { buildRecoveryConfig, buildEnroll, buildReconfigure } from '../recoveryStage3/config.js';
import { checkAccountWiring, buildWireAccountTx } from '../recoveryStage3/accountWiring.js';
import { readRecoveryConfig } from '../recoveryStage3/reads.js';
import { RECOVERY_CONTROLLER_TESTNET_ID } from '../recoveryStage3/deployment.js';
import {
  NO_BASELINE_DOC_SENTINEL,
  PENDING_ACTIVITY_POLICY_DEFAULT,
  DELAY_SECS_DEFAULT,
  EXPIRY_SECS_DEFAULT,
  MAX_CANCELS_DEFAULT,
} from '../recoveryStage3/defaults.js';

// Recovery *completion* (key rotation) lives in its own module; re-exported
// here per the public-API layout (buildInstall/buildRevoke + buildRotation
// all hang off the multisig-recovery block).
export {
  buildRotation,
  planRotation,
  describeRotation,
} from './multisigRotation.js';
export type {
  RotationRequest,
  RotationRuleState,
  RotationPlan,
  RotationCall,
  RotationTxBuild,
  BuildRotationArgs,
  NewPasskeySigner,
} from './multisigRotation.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export const multisigRecoveryModule: PolicyBlockModule<MultisigRecoveryBlock> = {
  kind: 'multisig-recovery',

  async buildInstall(args): Promise<TxBuild> {
    const { account, block, rpcUrl } = args;
    const controllerId = RECOVERY_CONTROLLER_TESTNET_ID;

    const wiring = await checkAccountWiring({
      account,
      controllerId,
      rpcUrl,
      networkPassphrase: TESTNET_PASSPHRASE,
    });
    if (wiring.status === 'wired-to-different-controller') {
      throw new Error(
        `multisig-recovery.buildInstall: this account is already wired to a ` +
          `different recovery controller (${wiring.currentControllerId}) — ` +
          `enrolling into the Stage 3 controller (${controllerId}) would write ` +
          `configuration nobody will ever cross-call. Reaching Stage 3 recovery ` +
          `requires first removing the existing recovery rule via the account's ` +
          `own real 7-day migration (initiate_recovery_rule_removal, wait out ` +
          `RECOVERY_REMOVAL_DELAY_SECS, then execute_recovery_rule_removal), ` +
          `then enrolling again. There is no faster path today.`,
      );
    }

    const readArgs = { account, controllerId, rpcUrl, networkPassphrase: TESTNET_PASSPHRASE };
    // A config can already exist here even for a `wired-to-target` account:
    // ZK recovery may have been set up FIRST (the wallet's "Add ZK
    // recovery" flow — see the frontend's `runZkEnrollment`), which wires
    // the SAME Stage 3 controller and enrolls `ZkOnly`. In that case this
    // is `reconfigure` (adding guardians -> `Combined`), never `enroll`
    // (which would hit `Error::AlreadyEnrolled`).
    const existing = wiring.status === 'wired-to-target' ? await readRecoveryConfig(readArgs) : null;

    if (existing) {
      if (existing.mode.tag !== 'GuardianOnly' && existing.mode.tag !== 'ZkOnly') {
        throw new Error(
          `multisig-recovery.buildInstall: this account's Stage 3 config is ` +
            `already ${existing.mode.tag}, not a state guardian recovery can be ` +
            `added on top of.`,
        );
      }
      if (existing.mode.tag === 'GuardianOnly') {
        throw new Error(
          `multisig-recovery.buildInstall: this account already has guardian ` +
            `recovery configured (${existing.guardian_threshold} of ` +
            `${existing.guardians.length}) — use the recovery card's edit ` +
            `flow, not install, to change the guardian set.`,
        );
      }
      // existing.mode.tag === 'ZkOnly': ADD guardians via reconfigure,
      // preserving every other field exactly (spread, don't rebuild) —
      // reconfigure rejects any change to baseline/timing/policy/profile.
      const reconfigured = buildReconfigure({
        controllerId,
        account,
        config: {
          ...existing,
          mode: { tag: 'Combined', values: undefined },
          guardians: block.friends.map((f) => f.address),
          guardian_threshold: block.threshold,
        },
      });
      return reconfigured;
    }

    const config = buildRecoveryConfig({
      mode: 'GuardianOnly',
      profile: 'Loss',
      guardians: block.friends.map((f) => f.address),
      guardianThreshold: block.threshold,
      networkPassphrase: TESTNET_PASSPHRASE,
      baselineDocHash: NO_BASELINE_DOC_SENTINEL,
      delaySecs: DELAY_SECS_DEFAULT,
      expirySecs: EXPIRY_SECS_DEFAULT,
      maxCancels: MAX_CANCELS_DEFAULT,
      pendingActivityPolicy: PENDING_ACTIVITY_POLICY_DEFAULT,
    });
    const enroll = buildEnroll({ controllerId, account, config });

    if (wiring.status === 'unwired') {
      const wire = await buildWireAccountTx({
        account,
        controllerId,
        rpcUrl,
        networkPassphrase: TESTNET_PASSPHRASE,
      });
      return {
        operations: [...wire.operations, ...enroll.operations],
        description: `Wire account to Stage 3 recovery, then enroll ${block.threshold} of ${block.friends.length} friends`,
      };
    }

    // wiring.status === 'wired-to-target', no existing config: just enroll.
    return enroll;
  },

  async buildRevoke(args): Promise<TxBuild> {
    // No `enroll`-reversing entry point exists on `RecoveryController` —
    // `reconfigure` (crate doc comment's "Known limits") only ever ADDS a
    // missing evidence factor, never removes one, and enrollment itself is
    // otherwise one-shot. There is no `uninstall` callable directly either;
    // `Policy::uninstall` only runs as a cross-call from the account's own
    // `remove_policy`/rule-removal path, which itself is gated by the real
    // 7-day `initiate_recovery_rule_removal` -> `execute_recovery_rule_removal`
    // flow (`contracts/smart-account/src/contract.rs`) — there is no
    // one-transaction revoke to build here at all.
    throw new Error(
      `multisig-recovery.buildRevoke: Stage 3 enrollment has no one-step revoke. ` +
        `Removing rule #${args.ruleId} requires the account's own real 7-day ` +
        `migration: initiate_recovery_rule_removal, wait out ` +
        `RECOVERY_REMOVAL_DELAY_SECS, then execute_recovery_rule_removal. ` +
        `That flow is not yet exposed as a single buildable transaction here.`,
    );
  },

  fromChain(rule: ChainRule, state: PolicyState, overlay: LocalOverlay): MultisigRecoveryBlock | null {
    if (rule.policies.length === 0) return null;
    if (rule.contextType.kind !== 'call-contract') return null;
    const policyAddr = rule.policies[0];
    const ps = state[policyAddr] as { threshold?: number; guardians?: string[] } | undefined;
    if (!ps) return null;

    // Stage 3 shape: zero on-chain signers, guardians live in the
    // controller's own per-account RecoveryConfig (`policyChainFetch.ts`
    // shapes this from `RecoveryController::config`). Distinguished from
    // the legacy multisig-policy shape below by `ps.guardians` being
    // present at all. A `ZkOnly` account's config has NO guardians
    // (`ps.guardians` is a present-but-empty array) — that's not a
    // guardian-recovery block at all, so this correctly returns null and
    // lets a future zk-recovery-specific block module claim it instead.
    if (Array.isArray(ps.guardians)) {
      if (typeof ps.threshold !== 'number' || ps.guardians.length === 0) return null;
      return {
        kind: 'multisig-recovery',
        ruleId: rule.ruleId,
        threshold: ps.threshold,
        friends: ps.guardians.map((address) => ({
          address,
          inputAs: address,
          nickname: overlay.friendNicknames[address],
        })),
        label: overlay.blockLabels[rule.ruleId],
      };
    }

    // Legacy shape (pre-Stage-3): friends are literal `Delegated` signers
    // on the rule itself, threshold comes from an attached multisig-policy.
    // Kept so an account that already has this rule installed (e.g. via
    // `enrollRecoveryRule`/the test harness, or a pre-201-rework install)
    // doesn't silently lose its only Revoke path from the UI — see
    // `fetchPolicyState`'s "unreadable, not {}" comment for the same
    // "never silently vanish a block" principle.
    const threshold = ps.threshold;
    if (typeof threshold !== 'number') return null;
    return {
      kind: 'multisig-recovery',
      ruleId: rule.ruleId,
      threshold,
      friends: rule.signers
        .filter((s): s is { kind: 'delegated'; address: string } => s.kind === 'delegated')
        .map((s) => ({
          address: s.address,
          inputAs: s.address,
          nickname: overlay.friendNicknames[s.address],
        })),
      label: overlay.blockLabels[rule.ruleId],
    };
  },

  summarize(block: MultisigRecoveryBlock): string {
    const n = block.friends.length;
    return `${block.threshold} of ${n} friend${n === 1 ? '' : 's'} can rotate this account's signers and rules`;
  },

  defaultDraft(): MultisigRecoveryBlock {
    return { kind: 'multisig-recovery', threshold: 2, friends: [], label: 'Recovery' };
  },
};

registerPolicyBlockModule(multisigRecoveryModule);
