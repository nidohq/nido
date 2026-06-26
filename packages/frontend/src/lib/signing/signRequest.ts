export type OperationDescriptor =
  | { type: "register"; name: string }
  | { type: "transfer"; token: string; to: string; amountRaw: string; decimals?: number; code?: string }
  | {
      type: "add-context-rule";
      target: string;
      signerPublicKeyHex: string;
      verifierAddress: string;
      validUntil: number | null;
      limit?: { stroops: string; periodLedgers: number } | null;
      label?: string;
    }
  | { type: "remove-context-rule"; ruleId: number; target: string }
  | { type: "raw-xdr"; xdr: string };

export type SignKind =
  | "name-claim" | "transfer" | "session-grant" | "session-revoke" | "dapp-tx" | "generic";

export type SubmitMode = "relayer" | "return-to-dapp";

export type EditableControl = {
  field: "spending-limit";
  initialStroops: string | null;
  initialPeriod: "day" | "week" | "30d";
};

export type ReturnTarget =
  | { type: "route"; url: string }
  | { type: "dapp"; origin: string; returnUrl?: string };

export interface SignRequest {
  v: 1;
  kind: SignKind;
  account: string;
  operation: OperationDescriptor;
  title: string;
  subtitle?: string;
  submitMode: SubmitMode;
  editable?: EditableControl[];
  returnTarget: ReturnTarget;
  networkPassphrase?: string;
}

const KEY = (id: string) => `nido:signreq:${id}`;

export function stashSignRequest(req: SignRequest, store: Storage = sessionStorage): string {
  const id = crypto.randomUUID();
  store.setItem(KEY(id), JSON.stringify(req));
  return id;
}

export function loadSignRequest(id: string, store: Storage = sessionStorage): SignRequest | null {
  const raw = store.getItem(KEY(id));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SignRequest;
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}
