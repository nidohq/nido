/** HTML-escape a value for safe interpolation into an innerHTML string. */
export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** A contract function name shown as a method, `name()` in bold monospace
 *  (`.fn-call` in nido.css), so it never reads as prose. Escaped. */
export function fnCallHtml(name: string): string {
  return `<code class="fn-call">${esc(name)}()</code>`;
}
