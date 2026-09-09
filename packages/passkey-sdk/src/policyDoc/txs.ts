/**
 * Turning a lowered doc into transactions nido's existing signing flow can
 * execute: one `add_context_rule` invocation per lowered rule, in document
 * order, each returned as a `TxBuild` (Soroban allows one InvokeHostFunction
 * per transaction, so each step rides its own transaction — the caller signs
 * and submits them in order, exactly like the multisig rotation plan).
 */

import { Buffer } from 'buffer';
import { Client as SmartAccountClient } from '@nidohq/smart-account';
import type { Signer } from '@nidohq/smart-account';
import type { xdr } from '@stellar/stellar-sdk';
import { extractXdrOperations } from '../assembledTx.js';
import type { ChainSigner } from '../policyBlocks/types.js';
import { interpreterInstallParamsScVal, spendingLimitInstallParamsScVal } from './params.js';
import type { DocInstallStep, LoweredDoc } from './types.js';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

export interface BuildDocInstallArgs {
  /** The smart account to install onto. */
  account: string;
  rpcUrl: string;
  networkPassphrase?: string;
  /** The perch interpreter's address (canonical registry deployment — see
   *  `perchTestnetAddresses()`). Required when the plan uses the interpreter. */
  interpreterAddress?: string;
  /** Nido's stock spending-limit policy address (resolve via
   *  `fetchRegistryAddress('spending-limit-policy')`). Required when the plan
   *  carries a cap. */
  spendingLimitAddress?: string;
}

function toBindingSigner(s: ChainSigner): Signer {
  return s.kind === 'delegated'
    ? { tag: 'Delegated', values: [s.address] as readonly [string] }
    : {
        tag: 'External',
        values: [s.verifier, Buffer.from(s.publicKey)] as readonly [string, Buffer],
      };
}

/**
 * Build the install transactions for a lowered doc. Each step's
 * `operations[0]` feeds straight into the existing signing flow
 * (`signAndSubmit({ account, operation })`); submit steps in order.
 */
export async function buildDocInstallTxs(
  lowered: LoweredDoc,
  args: BuildDocInstallArgs,
): Promise<DocInstallStep[]> {
  if (lowered.usesInterpreter && !args.interpreterAddress) {
    throw new Error('policyDoc: plan attaches the perch interpreter but no interpreterAddress given');
  }
  if (lowered.usesSpendingLimit && !args.spendingLimitAddress) {
    throw new Error('policyDoc: plan carries a cap but no spendingLimitAddress given');
  }

  const client = new SmartAccountClient({
    contractId: args.account,
    networkPassphrase: args.networkPassphrase ?? TESTNET_PASSPHRASE,
    rpcUrl: args.rpcUrl,
  });

  const steps: DocInstallStep[] = [];
  for (const rule of lowered.rules) {
    const policies = new Map<string, xdr.ScVal>();
    if (rule.program !== undefined) {
      policies.set(
        args.interpreterAddress!,
        interpreterInstallParamsScVal(rule.program, lowered.docHash),
      );
    }
    if (rule.cap !== undefined) {
      policies.set(
        args.spendingLimitAddress!,
        spendingLimitInstallParamsScVal(rule.cap.limitStroops, rule.cap.periodLedgers),
      );
    }

    const tx = await client.add_context_rule({
      context_type: { tag: 'CallContract', values: [rule.contract] as readonly [string] },
      name: rule.name,
      valid_until: rule.validUntil,
      signers: rule.signers.map(toBindingSigner),
      policies,
    });

    steps.push({
      ruleName: rule.name,
      operations: extractXdrOperations(tx, 'policy-doc'),
      description: `Install policy rule "${rule.name}" for ${rule.contract}`,
    });
  }
  return steps;
}
