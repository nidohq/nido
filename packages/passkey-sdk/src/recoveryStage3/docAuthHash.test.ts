import { describe, it, expect } from 'vitest';
import { fieldToBytes32 } from '../zkRecovery/field.js';
import { buf2hex } from '../encoding.js';
import { computeDocAuthHash, ACTION_LOST_KEY } from './docAuthHash.js';

// Parity gate: fixture copied verbatim from
// `contracts/recovery-controller/src/zk.rs`'s
// `#[cfg(test)] compute_doc_auth_hash_matches_fixture` — this IS the exact
// witness `circuits/zk_recovery_doc/Prover.toml` was proved against
// (`crates/integration-tests/fixtures/zk_recovery_doc/`). A mismatch here
// means a real `bb prove` proof against that fixture would never verify
// against the contract's own recompute.
function bytes32(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

describe('computeDocAuthHash (recovery-controller zk.rs parity)', () => {
  it('matches the pinned zk_recovery_doc fixture auth_hash', () => {
    const got = computeDocAuthHash({
      action: ACTION_LOST_KEY,
      accountId32: bytes32(0x11),
      networkPassphrase: 'Test SDF Network ; September 2015',
      controllerId32: bytes32(0x22),
      targetDocHash32: bytes32(0x99),
      configVersion: 1,
      baselineOrSourceId32: bytes32(0x88),
      attemptId: 1n,
      timelockSecs: 1_209_600,
    });

    expect(buf2hex(fieldToBytes32(got))).toBe(
      '0f824a503a04acffc6ec611ef89dbb6a31fbd92a163864eff602e6d71905cb38',
    );
  });
});
