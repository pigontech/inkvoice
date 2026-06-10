/**
 * Sanitize HTML template content by stripping dangerous elements and attributes.
 * Uses regex replacements — no DOM parser needed.
 */
export function sanitizeHtml(html: string): string {
  let result = html;

  // Remove <script>...</script> tags (with content, case-insensitive, multiline)
  result = result.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  // Remove self-closing <script /> tags
  result = result.replace(/<script\b[^>]*\/>/gi, "");

  // Remove <iframe> tags (opening, closing, self-closing)
  result = result.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");
  result = result.replace(/<iframe\b[^>]*\/>/gi, "");

  // Remove <object> tags
  result = result.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "");
  result = result.replace(/<object\b[^>]*\/>/gi, "");

  // Remove <embed> tags
  result = result.replace(/<embed\b[^>]*>[\s\S]*?<\/embed>/gi, "");
  result = result.replace(/<embed\b[^>]*\/?>/gi, "");

  // Remove on* event handler attributes (onclick, onerror, onload, etc.)
  result = result.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // Remove javascript: URLs in href/src/action attributes
  result = result.replace(
    /(href|src|action)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi,
    '$1=""',
  );

  return result;
}
