import { beforeEach, describe, expect, it } from "vitest";
import { registerVisit } from "./handler.js";
import { clearVisits, getVisit, visitCount } from "./store.js";

const VALID_ADDRESS = "C" + "A".repeat(55);

// Shared, module-level state in the store — reset it before every test so
// one test's registrations can't leak into (or be counted by) another.
beforeEach(() => {
  clearVisits();
});

describe("registerVisit", () => {
  it("accepts a valid address and returns 201 with a visit id", () => {
    const result = registerVisit({ address: VALID_ADDRESS });

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ visit: expect.any(String) });
  });

  it("stores the address as pending, keyed by the returned visit id", () => {
    const result = registerVisit({ address: VALID_ADDRESS }) as {
      status: number;
      body: { visit: string };
    };

    const stored = getVisit(result.body.visit);
    expect(stored).toMatchObject({ address: VALID_ADDRESS, status: "pending" });
  });

  it("gives two separate registrations two different visit ids", () => {
    const first = registerVisit({ address: VALID_ADDRESS }) as { body: { visit: string } };
    const second = registerVisit({ address: VALID_ADDRESS }) as { body: { visit: string } };

    expect(first.body.visit).not.toBe(second.body.visit);
    expect(visitCount()).toBe(2);
  });

  it("rejects a missing address with 400 and stores nothing", () => {
    const result = registerVisit({});

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: expect.any(String) });
    expect(visitCount()).toBe(0);
  });

  it("rejects a non-string address with 400", () => {
    const result = registerVisit({ address: 12345 });

    expect(result.status).toBe(400);
    expect(visitCount()).toBe(0);
  });

  it("rejects an address that doesn't match the C-address shape with 400", () => {
    const result = registerVisit({ address: "not-a-real-address" });

    expect(result.status).toBe(400);
    expect(visitCount()).toBe(0);
  });

  it("rejects a body that isn't an object, without throwing", () => {
    // These look like they'd crash a naive `(body as {address?}).address`
    // read — null and a bare string both have no `.address` property to
    // destructure safely. registerVisit should answer 400, not throw.
    expect(() => registerVisit(null)).not.toThrow();
    expect(registerVisit(null).status).toBe(400);

    expect(() => registerVisit("oops")).not.toThrow();
    expect(registerVisit("oops").status).toBe(400);

    expect(visitCount()).toBe(0);
  });
});
