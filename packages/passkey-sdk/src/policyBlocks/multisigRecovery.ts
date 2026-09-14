import { sha256 } from '@noble/hashes/sha2.js';
import type {
  ChainRule, LocalOverlay, MultisigRecoveryBlock,
  PolicyBlockModule, PolicyState, TxBuild,
} from './types.js';
import { registerPolicyBlockModule } from './registry.js';
import { buildRecoveryConfig, buildEnroll } from '../recoveryStage3/config.js';
import { checkAccountWiring, buildWireAccountTx } from '../recoveryStage3/accountWiring.js';
import { RECOVERY_CONTROLLER_TESTNET_ID } from '../recoveryStage3/deployment.js';

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

/** `RecoveryConfig.baseline_doc_hash` is only ever CHECKED against for a
 *  `Compromise`-action attempt (`begin_attempt` requires
 *  `target_doc_hash == config.baseline_doc_hash` exactly in that case —
 *  `contracts/recovery-controller/src/contract.rs`). This simplified
 *  "trusted friends" install form has no baseline-document concept at all
 *  (it only ever produces friends + a threshold, never a reviewed
 *  PolicyDoc) and the current UI never exposes a `Compromise` attempt
 *  either — only `LostKey` (device-loss) recovery, whose target is derived
 *  from the account's CURRENT live document/rules at `begin_attempt` time,
 *  never from this field. So this is a documented, inert placeholder, not
 *  a real commitment: `sha256("nido-guardian-only: no-baseline-doc")`.
 *  Wiring a genuine baseline (and a `Compromise` UI path) through this
 *  simplified form is out of scope here — use `recover-v3` for that, which
 *  collects a real baseline document. */
const NO_BASELINE_DOC_SENTINEL = sha256(new TextEncoder().encode('nido-guardian-only: no-baseline-doc'));

/** `enroll` requires an explicit `pending_activity_policy` — TRANSITION_SPEC.md
 *  §10 / follow-up.md §7 are explicit that NEITHER `Freeze` NOR `Continue`
 *  is spec-mandated as a default; a production release must resolve this
 *  gate deliberately. This simplified form has no UI surface to ask the
 *  question, so it makes an explicit, documented implementer choice —
 *  `Freeze` — as the more conservative of the two for a security-recovery
 *  feature: it blocks ordinary account-authorized rule/document writes
 *  while a friend-recovery attempt is pending, which favors NOT letting an
 *  attacker who still holds device access neutralize the recovery in
 *  progress, at the cost of also freezing the legitimate owner's ordinary
 *  activity during a real recovery. Revisit if that tradeoff proves wrong
 *  in practice — this is an implementer default, not a spec default; the
 *  full `recover-v3` form lets an operator choose explicitly.
 */
const PENDING_ACTIVITY_POLICY_DEFAULT = 'Freeze' as const;

// Testnet-appropriate defaults (ordinary tunables, NOT the §7-gated axis
// above — TRANSITION_SPEC.md only withholds a default for
// `pendingActivityPolicy`/`policyWriteConflictPolicy`). Mirrors the scale of
// the pre-existing M1 module's testnet params (DEPLOYED.md: delay 60s
// there) while giving guardians a more realistic window to actually
// respond than 60s would: 10 minutes to collect approvals once initiated,
// 24h before an unpromoted attempt expires, 3 cancels before the attempt is
// permanently dead. Production values require the same deliberate-choice
// treatment DEPLOYED.md already gives M1's mainnet spec numbers — not
// invented here.
const DELAY_SECS_DEFAULT = 600;
const EXPIRY_SECS_DEFAULT = 86_400;
const MAX_CANCELS_DEFAULT = 3;

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

    // wiring.status === 'wired-to-target': already wired, just enroll.
    return enroll;
  },

  async buildRevoke(args): Promise<TxBuild> {
    // No `enroll`-reversing entry point exists on `RecoveryController` —
    // enrollment is one-shot by design (crate doc comment's "Known
    // limits": "No `reconfigure` entry point"). There is no `uninstall`
    // callable directly either; `Policy::uninstall` only runs as a
    // cross-call from the account's own `remove_policy`/rule-removal path,
    // which itself is gated by the real 7-day
    // `initiate_recovery_rule_removal` -> `execute_recovery_rule_removal`
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
    // present at all.
    if (Array.isArray(ps.guardians)) {
      if (typeof ps.threshold !== 'number') return null;
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
