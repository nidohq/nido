import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  findDeviceByIds: vi.fn(),
}));

vi.mock("usb", () => ({ usb: { findDeviceByIds: h.findDeviceByIds } }));

const { printReceipt } = await import("./printer.js");

function fakeDevice() {
  return {
    open: vi.fn(async () => {}),
    selectConfiguration: vi.fn(async () => {}),
    claimInterface: vi.fn(async () => {}),
    transferOut: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

const VISIT = { address: "CADDRESS", status: "funded" as const, createdAt: 0 };

describe("printReceipt", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends a formatted receipt to the device when found", async () => {
    const device = fakeDevice();
    h.findDeviceByIds.mockResolvedValue(device);

    await printReceipt("visit-1", VISIT);

    expect(device.open).toHaveBeenCalled();
    expect(device.selectConfiguration).toHaveBeenCalledWith(1);
    expect(device.claimInterface).toHaveBeenCalledWith(0);
    expect(device.close).toHaveBeenCalled();

    const sent = device.transferOut.mock.calls[0][1] as Uint8Array;
    const text = Buffer.from(sent).toString();
    expect(text).toContain("visit-1");
    expect(text).toContain("CADDRESS");
  });

  it("logs and returns without throwing when the printer isn't found", async () => {
    h.findDeviceByIds.mockResolvedValue(undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(printReceipt("visit-1", VISIT)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("visit-1"));
  });

  it("logs and still closes the device when sending fails", async () => {
    const device = fakeDevice();
    device.transferOut.mockRejectedValue(new Error("boom"));
    h.findDeviceByIds.mockResolvedValue(device);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(printReceipt("visit-1", VISIT)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("visit-1"), expect.any(Error));
    expect(device.close).toHaveBeenCalled();
  });
});
