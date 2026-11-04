// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { localSubmitterEnabled } from "./localSubmitterGate";

describe("local-submitter gate", () => {
  it("is on only for a testnet build that sets the flag", () => {
    expect(localSubmitterEnabled("1", "testnet")).toBe(true);
    expect(localSubmitterEnabled("1", "mainnet")).toBe(false);
    expect(localSubmitterEnabled(undefined, "testnet")).toBe(false);
    expect(localSubmitterEnabled("", "testnet")).toBe(false);
    expect(localSubmitterEnabled("true", "testnet")).toBe(false);
  });

  it("is set by the PR preview workflow alone, on a testnet build", () => {
    const dir = fileURLToPath(new URL("../../../../.github/workflows/", import.meta.url));
    const setting = readdirSync(dir).filter((f) =>
      /PUBLIC_NIDO_LOCAL_SUBMITTER\s*:/.test(readFileSync(join(dir, f), "utf8")),
    );
    expect(setting).toEqual(["preview.yml"]);
    const preview = readFileSync(join(dir, "preview.yml"), "utf8");
    expect(preview).not.toMatch(/PUBLIC_STELLAR_NETWORK\s*:\s*['"]?mainnet/);
    expect(preview).not.toMatch(/PUBLIC_RELAYER_URL\s*:/);
  });
});
