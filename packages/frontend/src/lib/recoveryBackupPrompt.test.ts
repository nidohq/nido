import { beforeEach, describe, expect, it } from 'vitest';
import {
  markBackupSetUp,
  hasBackupLocally,
  snoozeBackupPrompt,
  shouldShowBackupBanner,
} from './recoveryBackupPrompt';

const ACCT = 'CDV57KZN4NUAZMI73NSLXIJ3VVRNMOCUBXEXDWQG6SKBQZAU4WM7OSAZ';
const DAY = 24 * 60 * 60 * 1000;

describe('recoveryBackupPrompt', () => {
  beforeEach(() => localStorage.clear());

  it('shows the banner for a fresh account with no backup and no snooze', () => {
    expect(shouldShowBackupBanner(ACCT)).toBe(true);
    expect(hasBackupLocally(ACCT)).toBe(false);
  });

  it('permanently hides the banner once a backup is recorded', () => {
    markBackupSetUp(ACCT);
    expect(hasBackupLocally(ACCT)).toBe(true);
    expect(shouldShowBackupBanner(ACCT)).toBe(false);
  });

  it('a recorded backup outranks a snooze (banner stays hidden)', () => {
    markBackupSetUp(ACCT);
    snoozeBackupPrompt(ACCT);
    expect(shouldShowBackupBanner(ACCT)).toBe(false);
  });

  it('snooze hides the banner within its window and it reappears after', () => {
    const now = 1_000_000_000_000;
    snoozeBackupPrompt(ACCT, now);
    expect(shouldShowBackupBanner(ACCT, now + DAY)).toBe(false); // still snoozed
    expect(shouldShowBackupBanner(ACCT, now + 8 * DAY)).toBe(true); // window (7d) passed
  });

  it('namespaces per account', () => {
    const other = 'CBN7L4PQ7L4RVZ6REUZLAETJQWOP5PHN6HOBLZLVF2HK52HP6VIGBVBR';
    markBackupSetUp(ACCT);
    expect(shouldShowBackupBanner(ACCT)).toBe(false);
    expect(shouldShowBackupBanner(other)).toBe(true);
  });
});
