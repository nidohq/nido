export interface Visit {
  address: string;
  status: "pending" | "funded";
  createdAt: number;
}

// Private — everything outside this module goes through the functions below,
// never the Map directly.
const visits = new Map<string, Visit>();

export function addVisit(id: string, visit: Visit): void {
  visits.set(id, visit);
}

export function getVisit(id: string): Visit | undefined {
  return visits.get(id);
}

/** Flips a visit to "funded" and returns the updated record, or `undefined`
 *  if no visit exists with that id. */
export function markFunded(id: string): Visit | undefined {
  const visit = visits.get(id);
  if (!visit) return undefined;
  const funded: Visit = { ...visit, status: "funded" };
  visits.set(id, funded);
  return funded;
}

export function getPending(): [string, Visit][] {
  return [...visits].filter(([, v]) => v.status === "pending");
}

export function visitCount(): number {
  return visits.size;
}

export function clearVisits(): void {
  visits.clear();
}
