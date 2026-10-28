/**
 * HTML escaping for the values an email template is filled with, as emitted
 * JavaScript. It is idempotent: an `&` that already starts a character
 * reference (`&name;`, `&#123;`, `&#x1F;`) is left as it is, every other `&`,
 * `<` and `>` is escaped once. A value that arrives already escaped (the
 * lifecycle token scripts escape their tokens) is therefore not escaped a
 * second time, and a reference can only ever render as a character, never as
 * markup, so leaving one in place is safe.
 *
 * - `escapeHtmlValueJs(expr)`: for an email HTML body, where a value can sit
 *   inside an attribute (`href="{{url}}"`): quotes are escaped too.
 * - `escapeHtmlTextJs(expr)`: for a value that lands in text (a rich-text
 *   placeholder, a list item): `& < >` only, as before.
 */
const BARE_AMPERSAND = '/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});)/g'

export const escapeHtmlTextJs = (expression: string): string =>
  `${expression}.replace(${BARE_AMPERSAND}, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')`

export const escapeHtmlValueJs = (expression: string): string =>
  `${escapeHtmlTextJs(expression)}.replace(/"/g, '&quot;').replace(/'/g, '&#39;')`
