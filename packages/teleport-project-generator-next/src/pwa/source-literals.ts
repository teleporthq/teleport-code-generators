/**
 * `value` as a JavaScript expression to splice into generated source. JSON is
 * valid JavaScript except for two line terminators older parsers reject inside
 * strings, and `<` is escaped so a value can never close a surrounding
 * `<script>` element.
 */
export const toJsLiteral = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/</g, '\\u003c')

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** `value` safe to place in HTML text or a quoted attribute. */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])
