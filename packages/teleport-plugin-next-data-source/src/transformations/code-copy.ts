/**
 * The class of the Copy button every code block of a post's content carries
 * on the published page.
 *
 * ⛔ PAIRED with `CODE_COPY_BUTTON_CLASS` in teleport-gui
 * `features/blog/utils/post-body-styles.ts`, whose project classes are the
 * button's only look (the author sees and changes them under Blog).
 */
export const CODE_COPY_BUTTON_CLASS = 'tq-code-copy'

/**
 * Generates `addCodeCopyButtons(html)`: every `<pre>` of a post's content
 * opens with a Copy button, written into the server-rendered HTML so it is
 * there on the first paint; the click is handled by the one script the Next
 * generator ships with a content site (its code-copy runtime), which also
 * swaps the button's label for `data-copied-label` for a moment.
 *
 * The button is the `pre`'s FIRST child with no white space around it: inside
 * a `pre`, a line break is a line of the code. Idempotent: a block that has
 * its button is left alone.
 */
export const generateCodeCopyButtonsCode = (): string => `
var CODE_COPY_BUTTON_CLASS = '${CODE_COPY_BUTTON_CLASS}'
var CODE_COPY_BUTTON_HTML =
  '<button type="button" class="' + CODE_COPY_BUTTON_CLASS + '" data-copy-label="Copy" data-copied-label="Copied">Copy</button>'
var CODE_COPY_PRE_PATTERN = /<pre(\\s[^>]*)?>(?!<button[^>]*class="${CODE_COPY_BUTTON_CLASS}")/gi

function addCodeCopyButtons(html) {
  if (typeof html !== 'string' || html.indexOf('<pre') === -1) return html
  return html.replace(CODE_COPY_PRE_PATTERN, function (openingTag) {
    return openingTag + CODE_COPY_BUTTON_HTML
  })
}
`
