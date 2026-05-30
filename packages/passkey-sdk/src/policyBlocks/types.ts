import type { Operation } from '@stellar/stellar-sdk';

export interface Friend {
  /** Resolved C-address or G-address; authoritative. */
  address: string;
  /** Raw user input — preserved so the UI can re-display "alice" if that's what they typed. */
  inputAs: string;
  /** Local-only nickname overlay. */
  nickname?: string;
}

export type PolicyBlock =
  | MultisigRecoveryBlock
  | ScopedSessionKeyBlock;

export interface MultisigRecoveryBlock {
  kind: 'multisig-recovery';
  /** On-chain rule id once installed; absent for drafts. */
  ruleId?: number;
  threshold: number;
  friends: Friend[];
  label?: string;
}

export interface ScopedSessionKeyBlock {
  kind: 'scoped-session-key';
  ruleId?: number;
  targetContract: string;
  sessionPubkey: Uint8Array;
  /** WebAuthn credential ID if backed by a non-resident passkey;
   *  the raw IndexedDB key id otherwise. */
  credentialId: string;
  /** Optional expiry ledger sequence. */
  validUntil?: number;
  label?: string;
}

/** Parsed chain payload for one rule: the ContextRule plus any policy state. */
export interface ChainRule {
  ruleId: number;
  contextType:
    | { kind: 'default' }
    | { kind: 'call-contract'; contract: string }
    | { kind: 'create-contract'; wasm: Uint8Array };
  name: string;
  signers: ChainSigner[];
  policies: string[]; // policy contract addresses attached to this rule
  validUntil: number | null;
}

export type ChainSigner =
  | { kind: 'delegated'; address: string }
  | { kind: 'external'; verifier: string; publicKey: Uint8Array };

/** Per-policy state fetched from the policy contract, keyed by policy addr. */
export type PolicyState = Record<string, unknown>;

/** Local display/credential overlay loaded from storage. */
export interface LocalOverlay {
  friendNicknames: Record<string, string>;          // by address
  sessionKeyMaterial: Record<string, {              // by target contract
    privateKey: Uint8Array;
    credentialId: string;
    label?: string;
  }>;
  blockLabels: Record<number, string>;              // by ruleId
}

/** Result of a buildInstall / buildRevoke — operations the caller composes
 *  into a transaction. The caller signs with the primary passkey. */
export interface TxBuild {
  operations: Operation[];
  /** Brief description used in the signing UI. */
  description: string;
}

export interface PolicyBlockModule<B extends PolicyBlock> {
  kind: B['kind'];
  buildInstall(args: {
    account: string;
    block: B;
    factoryAddress: string;
    rpcUrl: string;
    /** Per-block-kind extras the caller may inject (e.g. registry-resolved addresses). */
    policyAddress?: (kind: string) => Promise<string>;
    verifierAddress?: () => Promise<string>;
  }): Promise<TxBuild>;
  buildRevoke(args: {
    account: string;
    ruleId: number;
    rpcUrl: string;
  }): Promise<TxBuild>;
  fromChain(rule: ChainRule, policyState: PolicyState, overlay: LocalOverlay): B | null;
  summarize(block: B): string;
  defaultDraft(): B;
}
