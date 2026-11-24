import { describe, it, expect } from "vitest";
import { qrSvg } from "./qrCode.js";

const ALICE = "CA4RBSE64FPGPKIAS7SGPOLKAZWCCGFLGPUKYOZD2GMEWREXS6EIHDBR";
const BOB = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

describe("qrSvg", () => {
  it("renders an SVG at the default 188px", async () => {
    const svg = await qrSvg(ALICE);
    expect(svg).toMatch(/^<svg[\s>]/);
    expect(svg).toContain('width="188"');
    expect(svg).toContain('height="188"');
  });

  it("honours a custom size", async () => {
    const svg = await qrSvg(ALICE, 96);
    expect(svg).toContain('width="96"');
    expect(svg).toContain('height="96"');
  });

  it("uses Nido's palette", async () => {
    const svg = (await qrSvg(ALICE)).toLowerCase();
    expect(svg).toContain("#16140f");
    expect(svg).toContain("#fffdf8");
  });

  it("is the same for the same data and differs for different data", async () => {
    expect(await qrSvg(ALICE)).toBe(await qrSvg(ALICE));
    expect(await qrSvg(ALICE)).not.toBe(await qrSvg(BOB));
  });
});
