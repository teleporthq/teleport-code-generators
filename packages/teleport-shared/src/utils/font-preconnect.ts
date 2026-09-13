/**
 * Preconnect hints for the font hosts a project's stylesheet links point at.
 *
 * ## Why this is worth a `<link>`
 *
 * A Google Fonts stylesheet is a two-hop dependency: the browser fetches the CSS
 * from `fonts.googleapis.com`, parses it, and only THEN discovers the font files
 * on `fonts.gstatic.com` — a second origin, needing its own DNS lookup, TCP
 * handshake and TLS negotiation, all of it starting after the CSS has already
 * come back. On a mobile connection that chain routinely costs a few hundred
 * milliseconds of invisible or fallback text.
 *
 * Two `preconnect` hints in the head let both handshakes run in parallel with
 * the CSS request instead of after it. It is the single cheapest font
 * optimisation there is: two tags, no behaviour change, nothing to configure.
 *
 * ## Why `crossorigin` matters on the gstatic hint
 *
 * Font files are fetched in CORS mode. A preconnect without `crossorigin` opens
 * a connection in the wrong mode, the browser cannot reuse it for the font
 * request, and it opens a SECOND one — so the hint costs a connection instead of
 * saving one. The stylesheet itself is a normal same-mode request and takes the
 * plain hint.
 */

/** One preconnect hint: an origin, and whether it needs CORS mode. */
export interface FontPreconnectHint {
  href: string
  crossorigin: boolean
}

const GOOGLE_FONTS_STYLESHEET_HOST = 'fonts.googleapis.com'
const GOOGLE_FONTS_FILE_HOST = 'fonts.gstatic.com'

/**
 * The hints a project needs, in head order, or an empty list when it loads no
 * fonts from a known host.
 *
 * Deliberately conservative: a preconnect to an origin the page never uses wastes
 * a connection, so this only answers for hosts whose two-hop behaviour is known.
 * A self-hosted font, or a font already inlined as `@font-face`, needs nothing —
 * its files come from an origin the browser has connected to anyway.
 */
export const resolveFontPreconnectHints = (
  assetPaths: ReadonlyArray<string | undefined>
): FontPreconnectHint[] => {
  const usesGoogleFonts = assetPaths.some(
    (path) => typeof path === 'string' && path.includes(GOOGLE_FONTS_STYLESHEET_HOST)
  )

  if (!usesGoogleFonts) {
    return []
  }

  return [
    { href: `https://${GOOGLE_FONTS_STYLESHEET_HOST}`, crossorigin: false },
    // CORS mode — see the note above; without it the connection is not reusable
    // for the font files and the hint becomes a cost rather than a saving.
    { href: `https://${GOOGLE_FONTS_FILE_HOST}`, crossorigin: true },
  ]
}
