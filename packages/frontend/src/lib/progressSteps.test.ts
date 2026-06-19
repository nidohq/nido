import { describe, it, expect, beforeEach } from "vitest";
import { mountSteps } from "./progressSteps";

function makeContainer(n: number): HTMLElement {
  const root = document.createElement("div");
  for (let i = 0; i < n; i++) {
    const item = document.createElement("div");
    item.className = "checkitem";
    const mark = document.createElement("span");
    mark.className = "check-mark";
    const sub = document.createElement("span");
    sub.className = "check-sub";
    sub.style.display = "none";
    item.append(mark, sub);
    root.append(item);
  }
  return root;
}

describe("mountSteps", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = makeContainer(3);
  });

  it("setProgress marks done/active/pending", () => {
    const c = mountSteps(root);
    c.setProgress(1, 1);
    const items = root.querySelectorAll<HTMLElement>(".checkitem");
    const marks = root.querySelectorAll<HTMLElement>(".check-mark");
    expect(items[0].style.opacity).toBe("1"); // done
    expect(marks[0].innerHTML).toContain("M5 13l4 4"); // check path
    expect(items[1].style.opacity).toBe("1"); // active
    expect(marks[1].innerHTML).toContain("spin"); // spinner
    expect(items[2].style.opacity).toBe("0.4"); // pending (jsdom normalises .4 → 0.4)
    expect(marks[2].innerHTML).toContain("border"); // ring
  });

  it("ticker sets and clears sub text", () => {
    const c = mountSteps(root);
    c.setProgress(0, 1);
    c.ticker(1, "Simulating…");
    const sub = root.querySelectorAll<HTMLElement>(".check-sub")[1];
    expect(sub.textContent).toBe("Simulating…");
    expect(sub.style.display).toBe("block");
    c.ticker(1, "");
    expect(sub.style.display).toBe("none");
  });

  it("changing progress away from a step clears its ticker", () => {
    const c = mountSteps(root);
    c.setProgress(0, 1);
    c.ticker(1, "working");
    c.setProgress(2, -1); // step 1 now done, no active
    const sub = root.querySelectorAll<HTMLElement>(".check-sub")[1];
    expect(sub.style.display).toBe("none");
  });

  it("finish marks every step done", () => {
    const c = mountSteps(root);
    c.finish();
    root.querySelectorAll<HTMLElement>(".check-mark").forEach((m) => {
      expect(m.innerHTML).toContain("M5 13l4 4");
    });
  });
});
