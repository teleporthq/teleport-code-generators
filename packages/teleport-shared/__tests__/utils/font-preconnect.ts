import { resolveFontPreconnectHints } from '../../src/utils/font-preconnect'

/**
 * A Google Fonts stylesheet is a TWO-HOP dependency: the CSS comes from
 * `fonts.googleapis.com`, and only once it has been parsed does the browser
 * discover the font files on `fonts.gstatic.com` — a second origin needing its
 * own DNS + TCP + TLS round trips, started after the CSS has already returned.
 *
 * Two things here are load-bearing:
 *  - the gstatic hint MUST be `crossorigin`, because fonts are fetched in CORS
 *    mode and a connection opened in the wrong mode cannot be reused (the hint
 *    then costs a connection instead of saving one);
 *  - a project that loads no Google font gets NO hints, because a preconnect to
 *    an origin the page never contacts is pure waste.
 */

describe('resolveFontPreconnectHints', () => {
  const googleFontsHref = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap'

  it('returns both hints when the project loads a Google font', () => {
    expect(resolveFontPreconnectHints([googleFontsHref])).toEqual([
      { href: 'https://fonts.googleapis.com', crossorigin: false },
      { href: 'https://fonts.gstatic.com', crossorigin: true },
    ])
  })

  // Without CORS mode the browser opens a second connection for the font files
  // and the hint becomes a cost rather than a saving.
  it('marks ONLY the font-file origin as crossorigin', () => {
    const hints = resolveFontPreconnectHints([googleFontsHref])
    const byHost = Object.fromEntries(hints.map((hint) => [hint.href, hint.crossorigin]))

    expect(byHost['https://fonts.gstatic.com']).toBe(true)
    expect(byHost['https://fonts.googleapis.com']).toBe(false)
  })

  it('returns nothing for a project with no Google font', () => {
    expect(resolveFontPreconnectHints(['/styles.css', '/fonts/Inter.woff2'])).toEqual([])
  })

  it('returns nothing for an empty or sparse asset list', () => {
    expect(resolveFontPreconnectHints([])).toEqual([])
    expect(resolveFontPreconnectHints([undefined, undefined])).toEqual([])
  })

  // A page loading three families still only needs one pair of connections.
  it('emits one pair however many font stylesheets there are', () => {
    expect(
      resolveFontPreconnectHints([
        'https://fonts.googleapis.com/css2?family=Inter',
        'https://fonts.googleapis.com/css2?family=Lora',
        '/styles.css',
      ])
    ).toHaveLength(2)
  })

  // Self-hosted fonts need no hint: their files come from the page's own origin,
  // which the browser has already connected to.
  it('ignores a self-hosted font', () => {
    expect(resolveFontPreconnectHints(['/assets/fonts/custom.css'])).toEqual([])
  })
})
