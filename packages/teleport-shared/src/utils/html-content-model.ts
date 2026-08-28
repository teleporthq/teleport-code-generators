/**
 * The subset of the HTML parsing algorithm that decides whether a piece of
 * generated markup survives a round trip through the browser's parser.
 *
 * Why a code generator needs this at all: server-side rendered markup is
 * re-parsed by the browser before React hydrates it. Most invalid nesting is
 * harmless — the parser keeps the tree it was given and only the validator
 * complains. A small, well-defined set of combinations is different: for those
 * the parser INSERTS or CLOSES tags on its own, so the DOM the browser builds
 * is not the DOM React rendered on the server. React then fails with
 * "Hydration failed because the initial UI does not match what was rendered on
 * the server", throws the server markup away and re-renders the whole page on
 * the client.
 *
 * The canonical example — and the one that shipped — is a link wrapper inside a
 * paragraph:
 *
 *   <p>… see our <a href="/terms"><div>Privacy Policy</div></a>.</p>
 *
 * `<div>` is not allowed in `<p>`, so the parser closes the paragraph before it
 * and re-opens the anchor outside — three sibling nodes where React rendered
 * one nested tree.
 *
 * The tables below mirror `validateDOMNesting` in react-dom (which is itself
 * written against the HTML5 parsing spec), so what the resolver checks at
 * generation time is exactly what React checks at runtime.
 *
 * @see https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inbody
 * @see https://nextjs.org/docs/messages/react-hydration-error
 */

/** Generic flow container. What `container` / `fragment` map to on HTML targets. */
export const GENERIC_FLOW_TAG = 'div'

/** Generic phrasing container. Valid everywhere a `div` is, and in `<p>` too. */
export const GENERIC_PHRASING_TAG = 'span'

export const PARAGRAPH_TAG = 'p'

/**
 * Foreign content: inside `<svg>` the HTML content model does not apply (an
 * `<a>`, a `<title>` or a `<text>` there mean something else entirely), so
 * walks stop at the boundary rather than mis-reporting an icon's internals.
 */
export const FOREIGN_CONTENT_ROOT_TAGS: ReadonlySet<string> = new Set(['svg', 'math'])

/**
 * Every element name the HTML parser knows. Anything outside this list is a
 * framework component (`Link`, `Repeater`, `TqMotion`, `Fragment`) or a custom
 * element: it has no content model of its own, so nesting rules pass straight
 * through it to whatever it renders.
 */
const HTML_TAG_NAMES: ReadonlySet<string> = new Set([
  'a',
  'abbr',
  'address',
  'area',
  'article',
  'aside',
  'audio',
  'b',
  'base',
  'bdi',
  'bdo',
  'blockquote',
  'body',
  'br',
  'button',
  'canvas',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'data',
  'datalist',
  'dd',
  'del',
  'details',
  'dfn',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hgroup',
  'hr',
  'html',
  'i',
  'iframe',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'link',
  'main',
  'map',
  'mark',
  'math',
  'menu',
  'meta',
  'meter',
  'nav',
  'nobr',
  'noscript',
  'object',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'param',
  'picture',
  'pre',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'script',
  'search',
  'section',
  'select',
  'slot',
  'small',
  'source',
  'span',
  'strong',
  'style',
  'sub',
  'summary',
  'sup',
  'svg',
  'table',
  'tbody',
  'td',
  'template',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'title',
  'tr',
  'track',
  'u',
  'ul',
  'var',
  'video',
  'wbr',
  // Obsolete but still special-cased by the parser.
  'center',
  'dir',
  'listing',
  'marquee',
  'plaintext',
  'xmp',
])

export const isHtmlTagName = (tag: string): boolean => HTML_TAG_NAMES.has(tag)

/**
 * Start tags that make the parser close an open `<p>` before inserting them.
 *
 * React's `findInvalidAncestorForTag` routes exactly these to
 * `pTagInButtonScope`; `form`, `li`, `dd` and `dt` are added because the spec
 * closes an open paragraph for them too (React tracks those under separate
 * counters, but the DOM damage — and therefore the hydration failure — is the
 * same).
 */
const PARAGRAPH_CLOSING_TAGS: ReadonlySet<string> = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'center',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'header',
  'hgroup',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'search',
  'section',
  'summary',
  'ul',
  'pre',
  'listing',
  'table',
  'hr',
  'xmp',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'form',
  'li',
  'dd',
  'dt',
])

export const closesOpenParagraph = (tag: string): boolean => PARAGRAPH_CLOSING_TAGS.has(tag)

/**
 * "Has an element in scope" boundaries. An `<a>`/`<button>`/`<nobr>` above one
 * of these is invisible to the parser's duplicate check, so a walk must forget
 * it when it descends past one.
 */
const SCOPE_BOUNDARY_TAGS: ReadonlySet<string> = new Set([
  'applet',
  'caption',
  'html',
  'table',
  'td',
  'th',
  'marquee',
  'object',
  'template',
  'foreignObject',
  'desc',
  'title',
])

export const endsInlineScope = (tag: string): boolean => SCOPE_BOUNDARY_TAGS.has(tag)

/**
 * "Has an element in BUTTON scope" — the same boundaries plus `<button>`.
 * `<p><button><div/></button></p>` is ugly but the parser leaves it alone, so
 * it is deliberately NOT reported or repaired.
 */
export const endsParagraphScope = (tag: string): boolean =>
  SCOPE_BOUNDARY_TAGS.has(tag) || tag === 'button'

/**
 * Tags the parser refuses to nest inside themselves: it closes (or, for
 * `<form>`, silently drops) the outer one instead.
 */
export const SELF_NESTING_TAGS: ReadonlySet<string> = new Set(['a', 'button', 'form', 'nobr'])

const HEADING_TAGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

export const isHeadingTag = (tag: string): boolean => HEADING_TAGS.has(tag)

/**
 * Parents with their own insertion mode: any child outside the allowed set is
 * moved out of the parent ("foster parenting") or dropped by the parser.
 */
const RESTRICTED_CHILDREN: Record<string, ReadonlySet<string>> = {
  select: new Set(['option', 'optgroup', 'hr', 'script', 'template']),
  optgroup: new Set(['option', 'script', 'template']),
  option: new Set<string>([]),
  tr: new Set(['td', 'th', 'style', 'script', 'template']),
  tbody: new Set(['tr', 'style', 'script', 'template']),
  thead: new Set(['tr', 'style', 'script', 'template']),
  tfoot: new Set(['tr', 'style', 'script', 'template']),
  colgroup: new Set(['col', 'template']),
  table: new Set(['caption', 'colgroup', 'tbody', 'tfoot', 'thead', 'style', 'script', 'template']),
}

/**
 * Is `childTag` allowed as a DIRECT child of `parentTag`? Only meaningful for
 * parents listed in `RESTRICTED_CHILDREN`; everything else answers `true`.
 */
export const acceptsChildTag = (parentTag: string, childTag: string): boolean => {
  const allowed = RESTRICTED_CHILDREN[parentTag]
  return allowed === undefined || allowed.has(childTag)
}
