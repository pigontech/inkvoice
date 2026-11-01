// Escaping helpers for values interpolated into HTML templates via Mustache's
// unescaped triple-brace (`{{{ }}}`). Address / bank-details fields keep line
// breaks as `<br>`, so they cannot be rendered with double-brace escaping; we
// instead escape the user-supplied parts here and insert the only markup (the
// `<br>`) ourselves, so injected tags render as inert text regardless of CSP.

/** Escape the five HTML-significant characters. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape a multi-line string, then turn newlines into `<br>` for HTML display. */
export function escapeMultiline(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

/** Collapse a multi-line address onto one line. Unescaped: render with double braces. */
export function inlineAddress(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ");
}

/** Escape each part, drop empty/nullish ones, and join with `<br>`. */
export function escapeLines(parts: Array<string | null | undefined>): string {
  return parts
    .filter((p): p is string => Boolean(p))
    .map(escapeHtml)
    .join("<br>");
}
