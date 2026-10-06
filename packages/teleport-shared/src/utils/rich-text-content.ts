/**
 * The stored form of rich-text content (a blog post body, a product
 * description) and its editor form.
 *
 * STORED: plain HTML — `<p>`, `<h1>`–`<h6>`, nested `<ul>`/`<ol>`, `<blockquote>`
 * holding paragraphs, `<pre><code class="language-x">`, `<table>` with its
 * `<thead>`/`<th>`, `<aside class="tq-callout" data-kind="note">`, the image and
 * embed figures, and inline marks. What a published page renders and what an
 * import writes.
 *
 * EDITOR: what a Quill editor can hold without rewriting it. Lists become one
 * flat `<ol>` of `<li data-list>` lines with `ql-indent-N` for nesting, a
 * blockquote becomes one `<blockquote>` line per paragraph, and everything Quill
 * has no blot for — a table, a code block, a callout, a list whose items hold
 * blocks, anything unknown — is wrapped in a PROTECTED block:
 * `<div class="tq-protected" data-tq-protected="table" contenteditable="false">`
 * holding the stored markup untouched. The editors register that wrapper as a
 * block embed, so Quill treats it as one atomic unit and never looks inside.
 *
 * Both editors (the studio post form on the `quill` fork, the generated admin
 * panel on react-quill-new) run `toEditorHtml` on the way in and
 * `fromEditorHtml` on the way out. `normalizeLegacyRichTextHtml` additionally
 * understands what the two editors wrote BEFORE this contract existed, so an
 * older post is cleaned on its next save and renders right meanwhile — it is
 * string-only, so the generated project can run it where there is no DOM.
 *
 * Emission rules (see `__tests__/_helpers/rich-text-content-runtime-emitter.ts`):
 * the generated admin editor receives these very functions printed as a module,
 * so an exported function may call only other exported functions and the
 * constants below — never an import or a module-private helper.
 */

export const PROTECTED_BLOCK_CLASS = 'tq-protected'
export const PROTECTED_BLOCK_ATTR = 'data-tq-protected'
export const PROTECTED_BLOCK_BLOT_NAME = 'tq-protected-block'

export const PROTECTED_BLOCK_KINDS = ['table', 'code', 'callout', 'list', 'quote', 'html']
export type ProtectedBlockKind = 'table' | 'code' | 'callout' | 'list' | 'quote' | 'html'

export interface ProtectedBlockValue {
  kind: ProtectedBlockKind
  /** The stored markup of the block, exactly as it will be written back. */
  html: string
}

export const CALLOUT_CLASS = 'tq-callout'
export const CALLOUT_KIND_ATTR = 'data-kind'
export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution']
export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution'

/** ⛔ PAIRED with `EMBED_CLASS_NAME` in `rich-text-embeds.ts` (a test keeps them equal). */
export const RICH_TEXT_EMBED_CLASS = 'tq-embed'
/** ⛔ PAIRED with the image blot in teleport-gui `features/blog/components/content-image-blot.ts`. */
export const RICH_TEXT_IMAGE_CLASS = 'ql-content-image'

export const QUILL_LIST_ITEM_ATTR = 'data-list'
export const QUILL_INDENT_CLASS_PREFIX = 'ql-indent-'

/** Marks that can sit inside a line; anything else is a block to Quill. */
export const RICH_TEXT_INLINE_TAGS = [
  'A',
  'ABBR',
  'B',
  'BR',
  'CODE',
  'DEL',
  'EM',
  'I',
  'IMG',
  'INS',
  'KBD',
  'MARK',
  'S',
  'SMALL',
  'SPAN',
  'STRIKE',
  'STRONG',
  'SUB',
  'SUP',
  'U',
]

/** Elements that stand on their own line; white space between two of them carries nothing. */
export const RICH_TEXT_BLOCK_TAGS = [
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DETAILS',
  'DIV',
  'DL',
  'DT',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'SUMMARY',
  'TABLE',
  'TBODY',
  'TD',
  'TFOOT',
  'TH',
  'THEAD',
  'TR',
  'UL',
]

/** Parses an HTML fragment into a detached body the way a browser would. */
export function parseRichTextFragment(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString('<!doctype html><html><body>' + html, 'text/html')
  return doc.body
}

export function escapeRichTextText(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeRichTextAttribute(value: string): string {
  return escapeRichTextText(value).replace(/"/g, '&quot;')
}

export function isProtectedBlockKind(
  value: string | null | undefined
): value is ProtectedBlockKind {
  return PROTECTED_BLOCK_KINDS.indexOf(String(value)) !== -1
}

/** The editor-side wrapper for one stored block. */
export function buildProtectedBlockHtml(kind: ProtectedBlockKind, html: string): string {
  return (
    `<div class="${PROTECTED_BLOCK_CLASS}" ${PROTECTED_BLOCK_ATTR}="${kind}" contenteditable="false">` +
    html +
    '</div>'
  )
}

export function readProtectedBlockValue(element: Element): ProtectedBlockValue {
  const kind = element.getAttribute(PROTECTED_BLOCK_ATTR)
  return {
    kind: isProtectedBlockKind(kind) ? kind : 'html',
    html: element.innerHTML,
  }
}

export function isCalloutKind(value: string | null | undefined): value is CalloutKind {
  return CALLOUT_KINDS.indexOf(String(value)) !== -1
}

/** The stored markup of a callout: a kind and the blocks it holds. */
export function buildCalloutHtml(kind: CalloutKind, innerHtml: string): string {
  return `<aside class="${CALLOUT_CLASS}" ${CALLOUT_KIND_ATTR}="${kind}">${innerHtml}</aside>`
}

/** The stored markup of a code block; `code` is already HTML-escaped when `escaped` is set. */
export function buildCodeBlockHtml(language: string, code: string, escaped?: boolean): string {
  const text = escaped ? code : escapeRichTextText(code || '')
  const lang = String(language || '').replace(/[^\w.+#-]/g, '')
  const classAttr = lang && lang !== 'plain' ? ` class="language-${lang}"` : ''
  return `<pre><code${classAttr}>${text}</code></pre>`
}

export function hasClass(element: Element, className: string): boolean {
  const classes = (element.getAttribute('class') || '').split(/\s+/)
  return classes.indexOf(className) !== -1
}

export function isRichTextInlineNode(node: Node): boolean {
  if (node.nodeType === 3 || node.nodeType === 8) {
    return true
  }
  if (node.nodeType !== 1) {
    return false
  }
  return RICH_TEXT_INLINE_TAGS.indexOf((node as Element).tagName) !== -1
}

export function isBlankTextNode(node: Node): boolean {
  return node.nodeType === 3 && !/\S/.test(node.nodeValue || '')
}

export function isRichTextBlockElement(node: Node | null): boolean {
  return (
    !!node && node.nodeType === 1 && RICH_TEXT_BLOCK_TAGS.indexOf((node as Element).tagName) !== -1
  )
}

/**
 * Drops the white space that only separates blocks (the newlines a Markdown
 * renderer puts between `<li>`s, after `</p>`) and collapses runs of it inside
 * text to the one space they render as, so stored HTML has one spelling
 * whatever wrote it. Everything inside `<pre>` stays.
 */
export function stripInterBlockWhitespace(root: Node): void {
  if (root.nodeType === 1 && (root as Element).tagName === 'PRE') {
    return
  }
  const rootIsBlock = root.nodeType !== 1 || isRichTextBlockElement(root)
  const children = Array.prototype.slice.call(root.childNodes) as Node[]
  children.forEach((child) => {
    if (child.nodeType === 3) {
      const afterBlock =
        isRichTextBlockElement(child.previousSibling) || (rootIsBlock && !child.previousSibling)
      const beforeBlock =
        isRichTextBlockElement(child.nextSibling) || (rootIsBlock && !child.nextSibling)
      // A run of white space renders as one space; stored HTML keeps it that way
      // (a no-break space is not white space here).
      let text = (child.nodeValue || '').replace(/[ \t\r\n\f]+/g, ' ')
      if (afterBlock) {
        text = text.replace(/^\s+/, '')
      }
      if (beforeBlock) {
        text = text.replace(/\s+$/, '')
      }
      if (!text && (afterBlock || beforeBlock)) {
        root.removeChild(child)
      } else if (text !== child.nodeValue) {
        child.nodeValue = text
      }
      return
    }
    if (child.nodeType === 1) {
      stripInterBlockWhitespace(child)
    }
  })
}

/** `<li><p>one paragraph</p></li>` means the same as `<li>one paragraph</li>`; stored HTML uses the short form. */
export function unwrapSingleParagraphListItems(root: Element): void {
  Array.prototype.slice.call(root.querySelectorAll('li')).forEach((item: Element) => {
    const paragraphs = Array.prototype.slice
      .call(item.children)
      .filter((child: Element) => child.tagName === 'P') as Element[]
    const blocks = Array.prototype.slice
      .call(item.children)
      .filter((child: Element) => !isRichTextInlineNode(child)) as Element[]
    const nested = blocks.filter((child) => child.tagName === 'UL' || child.tagName === 'OL')
    if (paragraphs.length !== 1 || blocks.length !== 1 + nested.length) {
      return
    }
    const paragraph = paragraphs[0]
    while (paragraph.firstChild) {
      item.insertBefore(paragraph.firstChild, paragraph)
    }
    item.removeChild(paragraph)
  })
}

/** A link to another web page: an absolute http(s) address. Everything else stays in the tab. */
export function isExternalWebLink(href: string): boolean {
  return /^https?:\/\//i.test(String(href || '').trim())
}

/**
 * Quill creates every link with `target="_blank"`. Stored HTML decides for
 * itself: a link to another web page opens in a new tab, a link to a page of
 * the same site (or a mail or phone link) opens in this one.
 */
export function normalizeLinkTargets(root: Element): void {
  Array.prototype.slice.call(root.querySelectorAll('a[href]')).forEach((link: Element) => {
    if (isExternalWebLink(link.getAttribute('href') || '')) {
      if (!link.getAttribute('target')) {
        link.setAttribute('rel', 'noopener noreferrer')
        link.setAttribute('target', '_blank')
      }
      return
    }
    link.removeAttribute('target')
    link.removeAttribute('rel')
  })
}

/** A quote holds paragraphs; bare inline content inside one becomes its single paragraph. */
export function wrapBareBlockquoteContent(root: Element): void {
  Array.prototype.slice.call(root.querySelectorAll('blockquote')).forEach((quote: Element) => {
    const children = Array.prototype.slice.call(quote.childNodes) as Node[]
    const bare = children.filter((child) => !isBlankTextNode(child))
    if (!bare.length || !bare.every((child) => isRichTextInlineNode(child))) {
      return
    }
    const paragraph = quote.ownerDocument.createElement('p')
    children.forEach((child) => paragraph.appendChild(child))
    quote.appendChild(paragraph)
  })
}

/** The markup of one node as it sits in its parent: text escaped, elements whole. */
export function serializeRichTextNode(node: Node): string {
  if (node.nodeType === 1) {
    return (node as Element).outerHTML
  }
  if (node.nodeType === 3) {
    return escapeRichTextText(node.nodeValue || '')
  }
  return ''
}

/**
 * The inline markup of a list item: text and marks, a single wrapping `<p>`
 * unwrapped, nested lists left out.
 */
export function readInlineHtml(element: Element): string {
  let html = ''
  Array.prototype.slice.call(element.childNodes).forEach((node: Node) => {
    if (node.nodeType === 1) {
      const child = node as Element
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        return
      }
      if (child.tagName === 'P') {
        html += child.innerHTML
        return
      }
    }
    html += serializeRichTextNode(node)
  })
  return html.replace(/^\s+|\s+$/g, '')
}

/**
 * A list Quill can hold as lines: every item is inline content (at most one
 * `<p>` around it) followed, at most, by one nested list that is itself simple,
 * and no `start` offset on a numbered list.
 */
export function isQuillSimpleList(list: Element): boolean {
  if (list.hasAttribute('start')) {
    return false
  }
  const items = Array.prototype.slice.call(list.children) as Element[]
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if (item.tagName !== 'LI') {
      return false
    }
    const children = Array.prototype.slice.call(item.childNodes) as Node[]
    let paragraphs = 0
    let nested: Element | null = null
    for (let j = 0; j < children.length; j += 1) {
      const child = children[j]
      if (isRichTextInlineNode(child)) {
        if (nested && !isBlankTextNode(child)) {
          return false
        }
        continue
      }
      const tag = (child as Element).tagName
      if (tag === 'P') {
        paragraphs += 1
        if (paragraphs > 1 || nested) {
          return false
        }
        continue
      }
      if ((tag === 'UL' || tag === 'OL') && !nested) {
        nested = child as Element
        continue
      }
      return false
    }
    if (nested && !isQuillSimpleList(nested)) {
      return false
    }
  }
  return true
}

/** One flat `<ol>` of `<li data-list>` lines, the shape Quill keeps a list in. */
export function flattenListForQuill(list: Element): string {
  let html = '<ol>'
  const walk = (node: Element, indent: number): void => {
    const type = node.tagName === 'OL' ? 'ordered' : 'bullet'
    Array.prototype.slice.call(node.children).forEach((item: Element) => {
      if (item.tagName !== 'LI') {
        return
      }
      const indentClass = indent > 0 ? ` class="${QUILL_INDENT_CLASS_PREFIX}${indent}"` : ''
      html += `<li ${QUILL_LIST_ITEM_ATTR}="${type}"${indentClass}>${readInlineHtml(item)}</li>`
      Array.prototype.slice.call(item.children).forEach((child: Element) => {
        if (child.tagName === 'UL' || child.tagName === 'OL') {
          walk(child, indent + 1)
        }
      })
    })
  }
  walk(list, 0)
  return html + '</ol>'
}

/** A blockquote Quill can hold: paragraphs (or bare inline content) only. */
export function isQuillSimpleBlockquote(quote: Element): boolean {
  const children = Array.prototype.slice.call(quote.childNodes) as Node[]
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]
    if (isRichTextInlineNode(child)) {
      continue
    }
    if ((child as Element).tagName !== 'P') {
      return false
    }
  }
  return true
}

/** One `<blockquote>` line per paragraph, the shape Quill keeps a quote in. */
export function blockquoteLinesForQuill(quote: Element): string {
  const lines: string[] = []
  let pending = ''
  const flush = (): void => {
    if (/\S/.test(pending)) {
      lines.push(pending.replace(/^\s+|\s+$/g, ''))
    }
    pending = ''
  }
  Array.prototype.slice.call(quote.childNodes).forEach((node: Node) => {
    if (node.nodeType === 1 && (node as Element).tagName === 'P') {
      flush()
      lines.push((node as Element).innerHTML)
      return
    }
    pending += serializeRichTextNode(node)
  })
  flush()
  return lines.map((line) => `<blockquote>${line}</blockquote>`).join('')
}

/** Which protected kind a stored block that Quill cannot hold gets. */
export function protectedKindForElement(element: Element): ProtectedBlockKind {
  const tag = element.tagName
  if (tag === 'TABLE') {
    return 'table'
  }
  if (tag === 'PRE') {
    return 'code'
  }
  if (tag === 'ASIDE' && hasClass(element, CALLOUT_CLASS)) {
    return 'callout'
  }
  if (tag === 'UL' || tag === 'OL') {
    return 'list'
  }
  if (tag === 'BLOCKQUOTE') {
    return 'quote'
  }
  return 'html'
}

/**
 * Stored HTML → what the editor is given. Every block Quill holds natively is
 * handed over in Quill's own shape; every other block is protected.
 */
export function toEditorHtml(storedHtml: string): string {
  const body = parseRichTextFragment(normalizeLegacyRichTextHtml(storedHtml))
  let html = ''
  Array.prototype.slice.call(body.childNodes).forEach((node: Node) => {
    if (node.nodeType === 3) {
      if (/\S/.test(node.nodeValue || '')) {
        html += '<p>' + escapeRichTextText(node.nodeValue || '') + '</p>'
      }
      return
    }
    if (node.nodeType !== 1) {
      return
    }
    const element = node as Element
    const tag = element.tagName
    if (tag === 'P' || /^H[1-6]$/.test(tag)) {
      html += element.outerHTML
      return
    }
    if (isRichTextInlineNode(element)) {
      html += '<p>' + element.outerHTML + '</p>'
      return
    }
    if (tag === 'DIV' && hasClass(element, PROTECTED_BLOCK_CLASS)) {
      html += element.outerHTML
      return
    }
    if (
      tag === 'FIGURE' &&
      (hasClass(element, RICH_TEXT_IMAGE_CLASS) || hasClass(element, RICH_TEXT_EMBED_CLASS))
    ) {
      html += element.outerHTML
      return
    }
    if ((tag === 'UL' || tag === 'OL') && isQuillSimpleList(element)) {
      html += flattenListForQuill(element)
      return
    }
    if (tag === 'BLOCKQUOTE' && isQuillSimpleBlockquote(element)) {
      html += blockquoteLinesForQuill(element)
      return
    }
    html += buildProtectedBlockHtml(protectedKindForElement(element), element.outerHTML)
  })
  return html
}

/**
 * What the editor holds → stored HTML. Protected blocks are unwrapped, Quill's
 * flat lists and blockquote lines are rebuilt, and Quill's own helpers are
 * stripped. Idempotent on stored HTML.
 */
export function fromEditorHtml(editorHtml: string): string {
  const body = parseRichTextFragment(editorHtml)
  Array.prototype.slice
    .call(body.querySelectorAll('.' + PROTECTED_BLOCK_CLASS))
    .forEach((wrapper: Element) => {
      const parent = wrapper.parentNode
      if (!parent) {
        return
      }
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper)
      }
      parent.removeChild(wrapper)
    })
  const normalized = parseRichTextFragment(normalizeLegacyRichTextHtml(body.innerHTML))
  unwrapSingleParagraphListItems(normalized)
  wrapBareBlockquoteContent(normalized)
  normalizeLinkTargets(normalized)
  stripInterBlockWhitespace(normalized)
  return trimEmptyEdgeParagraphs(normalized.innerHTML)
}

/** Stored HTML in its one canonical spelling, whatever dialect it arrived in. */
export function toCanonicalRichTextHtml(html: string): string {
  return fromEditorHtml(html)
}

/** Quill keeps an empty line as `<p><br></p>`; one at either end carries nothing. */
export function trimEmptyEdgeParagraphs(html: string): string {
  return html
    .replace(/^(?:\s*<p>(?:<br\s*\/?>|\s|&nbsp;)*<\/p>)+/, '')
    .replace(/(?:<p>(?:<br\s*\/?>|\s|&nbsp;)*<\/p>\s*)+$/, '')
}

/**
 * What the editors wrote before this contract, turned into stored HTML. String
 * only, so a generated page can run it in `getStaticProps`:
 * - the studio's lists: one `<ol>` of `<li data-list="bullet|ordered">` with
 *   `ql-indent-N` and an empty `<span class="ql-ui">` per line;
 * - the studio's code blocks: `div.ql-code-block-container` of line divs;
 * - the studio's quotes: one `<blockquote>` element per line;
 * - the admin panel's text: every space a no-break space;
 * - the admin panel's code blocks: `<pre data-language>` with no `<code>`.
 * Leaves stored HTML as it is.
 */
export function normalizeLegacyRichTextHtml(html: string): string {
  let out = String(html || '')
  out = out.replace(/<span class="ql-ui"[^>]*>(?:<\/span>)?/g, '')
  out = out.replace(
    /<(ol|ul)(\s[^>]*)?>((?:(?!<\/?(?:ol|ul)\b)[\s\S])*)<\/\1>/g,
    (match, _tag, _attrs, inner) =>
      inner.indexOf(QUILL_LIST_ITEM_ATTR + '=') === -1 ? match : rebuildQuillListHtml(inner)
  )
  out = out.replace(
    /<div class="ql-code-block-container"[^>]*>((?:\s*<div class="ql-code-block"[^>]*>[\s\S]*?<\/div>)*)\s*<\/div>/g,
    (_match, inner) => rebuildQuillCodeBlockHtml(inner)
  )
  out = out.replace(
    /<pre data-language="([^"]*)">\n?([\s\S]*?)\n?<\/pre>/g,
    (_match, language, code) => buildCodeBlockHtml(language, code, true)
  )
  out = out.replace(/((?:<blockquote>(?:(?!<\/?blockquote\b)[\s\S])*<\/blockquote>\s*)+)/g, (run) =>
    mergeBlockquoteLines(run)
  )
  out = out.replace(/(\S)(?:&nbsp;| )(?=\S)/g, '$1 ')
  return out
}

/** The nested `<ul>`/`<ol>` that a flat run of Quill list lines means. */
export function rebuildQuillListHtml(innerHtml: string): string {
  const items: Array<{ type: string; indent: number; html: string }> = []
  const pattern = /<li\b([^>]*)>([\s\S]*?)<\/li>/g
  let match = pattern.exec(innerHtml)
  while (match) {
    const attrs = match[1]
    const typeMatch = /data-list="([^"]*)"/.exec(attrs)
    const indentMatch = /ql-indent-(\d+)/.exec(attrs)
    items.push({
      type: typeMatch && typeMatch[1] === 'ordered' ? 'ordered' : 'bullet',
      indent: indentMatch ? parseInt(indentMatch[1], 10) : 0,
      html: match[2].replace(/^\s+|\s+$/g, ''),
    })
    match = pattern.exec(innerHtml)
  }
  if (!items.length) {
    return ''
  }
  const render = (from: number, level: number): { html: string; next: number } => {
    let html = ''
    let i = from
    let openType = ''
    const close = (): void => {
      if (openType) {
        html += openType === 'ordered' ? '</ol>' : '</ul>'
        openType = ''
      }
    }
    while (i < items.length) {
      const item = items[i]
      if (item.indent < level) {
        break
      }
      if (item.indent > level) {
        // A deeper line with nothing above it reads as this level.
        item.indent = level
      }
      if (openType !== item.type) {
        close()
        openType = item.type
        html += openType === 'ordered' ? '<ol>' : '<ul>'
      }
      html += '<li>' + item.html
      i += 1
      if (i < items.length && items[i].indent > level) {
        const nested = render(i, level + 1)
        html += nested.html
        i = nested.next
      }
      html += '</li>'
    }
    close()
    return { html, next: i }
  }
  return render(0, 0).html
}

/** The `<pre><code>` that a run of the studio's code-block line divs means. */
export function rebuildQuillCodeBlockHtml(innerHtml: string): string {
  const lines: string[] = []
  let language = ''
  const pattern = /<div class="ql-code-block"([^>]*)>([\s\S]*?)<\/div>/g
  let match = pattern.exec(innerHtml)
  while (match) {
    const languageMatch = /data-language="([^"]*)"/.exec(match[1])
    if (languageMatch && !language) {
      language = languageMatch[1]
    }
    lines.push(match[2] === '<br>' ? '' : match[2])
    match = pattern.exec(innerHtml)
  }
  return buildCodeBlockHtml(language, lines.join('\n'), true)
}

/**
 * One `<blockquote>` of paragraphs out of a run of single-line quotes (one line
 * is a run too). A run whose lines already hold blocks is stored HTML and is
 * left alone.
 */
export function mergeBlockquoteLines(run: string): string {
  const lines: string[] = []
  const pattern = /<blockquote>([\s\S]*?)<\/blockquote>/g
  let match = pattern.exec(run)
  while (match) {
    if (/<(?:p|ul|ol|div|pre|table|aside|figure|h[1-6])\b/.test(match[1])) {
      return run
    }
    lines.push(match[1])
    match = pattern.exec(run)
  }
  return '<blockquote>' + lines.map((line) => '<p>' + line + '</p>').join('') + '</blockquote>'
}
