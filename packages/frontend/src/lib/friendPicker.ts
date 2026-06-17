export interface PickerRow {
  address: string;
  label: string;
  signed: boolean;
}

export function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Merge friend addresses with resolved names + the signed set into rows. */
export function buildPickerRows(
  friends: string[],
  names: Map<string, string>,
  signed: Set<string>,
): PickerRow[] {
  return friends.map((address) => ({
    address,
    label: names.get(address) ?? truncateAddress(address),
    signed: signed.has(address),
  }));
}
