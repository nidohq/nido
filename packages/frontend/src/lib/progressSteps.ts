// Reusable creation/claim progress ticker. Operates over a container whose
// direct children are `.checkitem` elements, each holding a `.check-mark` (icon
// slot) and an optional `.check-sub` (sub-step ticker). Mirrors the new-account
// creation ticker so the claim flow shows the same polished progress.

export type StepState = "pending" | "active" | "done";

export interface StepsController {
  /** Mark steps [0,done) done, `activeIdx` active (pass -1 for none), rest pending. */
  setProgress(done: number, activeIdx: number): void;
  /** Set/clear the sub-step ticker text under step i. */
  ticker(i: number, text: string): void;
  /** Mark every step done (terminal state). */
  finish(): void;
}

const DONE_MARK =
  '<span style="width:24px;height:24px;border-radius:50%;background:var(--good);display:grid;place-items:center;">' +
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></span>';

const ACTIVE_MARK =
  '<svg class="spin" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16"/><path d="M4 20v-4h4"/></svg>';

const PENDING_MARK =
  '<span style="width:24px;height:24px;border-radius:50%;border:2px solid var(--line);display:block;"></span>';

export function mountSteps(container: HTMLElement): StepsController {
  const items = () => Array.from(container.querySelectorAll<HTMLElement>(".checkitem"));

  function ticker(i: number, text: string) {
    const sub = items()[i]?.querySelector<HTMLElement>(".check-sub");
    if (!sub) return;
    sub.textContent = text;
    sub.style.display = text ? "block" : "none";
  }

  function render(i: number, state: StepState) {
    const item = items()[i];
    if (!item) return;
    item.style.opacity = state === "pending" ? ".4" : "1";
    if (state !== "active") ticker(i, "");
    const mark = item.querySelector<HTMLElement>(".check-mark");
    if (mark) mark.innerHTML = state === "done" ? DONE_MARK : state === "active" ? ACTIVE_MARK : PENDING_MARK;
  }

  function setProgress(done: number, activeIdx: number) {
    const n = items().length;
    for (let i = 0; i < n; i++) {
      render(i, i < done ? "done" : i === activeIdx ? "active" : "pending");
    }
  }

  function finish() {
    setProgress(items().length, -1);
  }

  return { setProgress, ticker, finish };
}
