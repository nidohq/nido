/** Talks to infra/invite over its public HTTP API — never anything reaching
 *  the other way. See demo-plan.md for why: this laptop has no inbound route
 *  from the internet, so it has to be the one calling out. */
export class InviteClient {
    baseUrl;
    apiKey;
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    headers() {
        const headers = { "Content-Type": "application/json" };
        if (this.apiKey)
            headers["x-api-key"] = this.apiKey;
        return headers;
    }
    async createCode() {
        const res = await fetch(`${this.baseUrl}/codes`, { method: "POST", headers: this.headers() });
        if (!res.ok)
            throw new Error(`createCode failed: ${res.status} ${await res.text()}`);
        return res.json();
    }
    /** `undefined` means the print queue is empty right now (infra/invite
     *  answers 204, not an error). */
    async nextPendingPrint() {
        const res = await fetch(`${this.baseUrl}/pending-print/next`, { headers: this.headers() });
        if (res.status === 204)
            return undefined;
        if (!res.ok)
            throw new Error(`nextPendingPrint failed: ${res.status} ${await res.text()}`);
        return res.json();
    }
    async ackPendingPrint(code) {
        const res = await fetch(`${this.baseUrl}/pending-print/${encodeURIComponent(code)}/ack`, {
            method: "POST",
            headers: this.headers(),
        });
        if (!res.ok)
            throw new Error(`ackPendingPrint failed: ${res.status} ${await res.text()}`);
    }
}
//# sourceMappingURL=inviteClient.js.map