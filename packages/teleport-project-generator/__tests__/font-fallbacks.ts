import { ProjectUIDL } from '@teleporthq/teleport-types'
import {
  applyFontFallbacks,
  FONT_FALLBACKS_STYLE_TAG,
  fontFallbackFaces,
  googleFamiliesInStylesheetUrl,
  googleFamiliesWithFallbacks,
  withFontFallbacks,
  withFontFallbacksInCss,
} from '../src/font-fallbacks'
import { GOOGLE_FONT_FALLBACK_METRICS } from '../src/font-fallbacks/google-font-fallbacks.generated'

const SPACE_GROTESK =
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap'
const MANROPE = 'https://fonts.googleapis.com/css2?family=Manrope:wght@200;800&display=swap'

const loaded = googleFamiliesWithFallbacks([
  { type: 'font', path: SPACE_GROTESK },
  { type: 'font', path: MANROPE },
])

describe('font fallbacks', () => {
  it('reads the families a Google Fonts stylesheet asks for, in both APIs', () => {
    expect(googleFamiliesInStylesheetUrl(SPACE_GROTESK)).toEqual(['Space Grotesk'])
    expect(
      googleFamiliesInStylesheetUrl(
        'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400&family=Noto+Sans&display=swap'
      )
    ).toEqual(['Inter', 'Noto Sans'])
    expect(
      googleFamiliesInStylesheetUrl(
        'https://fonts.googleapis.com/css?family=Roboto:400,700|Open+Sans'
      )
    ).toEqual(['Roboto', 'Open Sans'])
    expect(googleFamiliesInStylesheetUrl('https://example.com/fonts.css?family=Roboto')).toEqual([])
  })

  it('puts the stand-in right after each loaded family and leaves the rest as written', () => {
    expect(withFontFallbacks('Manrope', loaded)).toBe('Manrope, Manrope Fallback')
    expect(withFontFallbacks('"Space Grotesk"', loaded)).toBe(
      '"Space Grotesk", Space Grotesk Fallback'
    )
    expect(withFontFallbacks("'Manrope', sans-serif", loaded)).toBe(
      "'Manrope', Manrope Fallback, sans-serif"
    )
    expect(withFontFallbacks('manrope', loaded)).toBe('manrope, Manrope Fallback')
    expect(withFontFallbacks('Inter, sans-serif', loaded)).toBe('Inter, sans-serif')
    expect(withFontFallbacks('var(--font-family-body)', loaded)).toBe('var(--font-family-body)')
    expect(withFontFallbacks('Manrope, Manrope Fallback', loaded)).toBe('Manrope, Manrope Fallback')
  })

  it('rewrites stacks in CSS text but never the name an @font-face defines', () => {
    const css = [
      'html { font-family: "Space Grotesk"; font-size: 16px; }',
      '.title{font-family:Manrope !important}',
      ':root { --font-family-heading: Manrope; --font-size-lg: 1.25rem; }',
      '@font-face { font-family: "Manrope"; src: url(/manrope.woff2); }',
    ].join('\n')
    expect(withFontFallbacksInCss(css, loaded)).toBe(
      [
        'html { font-family: "Space Grotesk", Space Grotesk Fallback; font-size: 16px; }',
        '.title{font-family:Manrope, Manrope Fallback !important}',
        ':root { --font-family-heading: Manrope, Manrope Fallback; --font-size-lg: 1.25rem; }',
        '@font-face { font-family: "Manrope"; src: url(/manrope.woff2); }',
      ].join('\n')
    )
  })

  it('sizes each stand-in from the measured metrics', () => {
    const [reference, sizeAdjust] = GOOGLE_FONT_FALLBACK_METRICS.spacegrotesk
    expect(reference).toBe('Arimo')
    const faces = fontFallbackFaces(loaded)
    expect(faces).toContain('font-family: Space Grotesk Fallback;')
    expect(faces).toContain('src: local("Arial"), local("ArialMT"), local("Liberation Sans")')
    expect(faces).toContain(`size-adjust: ${Number((sizeAdjust * 100).toFixed(2))}%;`)
    expect(faces).toMatch(
      /ascent-override: [\d.]+%;\s+descent-override: [\d.]+%;\s+line-gap-override: [\d.]+%;/
    )
  })

  it('has plausible measurements for every family', () => {
    const entries = Object.entries(GOOGLE_FONT_FALLBACK_METRICS)
    expect(entries.length).toBeGreaterThan(1000)
    for (const [family, [, sizeAdjust, ascent, descent, lineGap]] of entries) {
      expect({ family, ok: sizeAdjust > 0.3 && sizeAdjust < 3 }).toEqual({ family, ok: true })
      expect({ family, ok: ascent > 0 && descent >= 0 && lineGap >= 0 }).toEqual({
        family,
        ok: true,
      })
    }
  })

  describe('on a project', () => {
    const project = (): ProjectUIDL =>
      ({
        name: 'shop',
        globals: {
          settings: { title: 'Shop', language: 'en' },
          meta: [],
          assets: [
            { type: 'style', content: 'html { font-family: "Space Grotesk"; }' },
            { type: 'font', path: SPACE_GROTESK },
            { type: 'font', path: MANROPE },
          ],
          customCode: {
            head: '<style>.post h2 { font-family: manrope }</style><script>var font-family</script>',
          },
        },
        root: {
          name: 'App',
          designLanguage: { tokens: { '--font-heading': { type: 'static', content: 'Manrope' } } },
          styleSetDefinitions: {
            heading: {
              type: 'reusable-project-style-map',
              content: { fontFamily: { type: 'static', content: 'Manrope' } },
              conditions: [
                {
                  type: 'screen-size',
                  meta: { maxWidth: 767 },
                  content: { fontFamily: { type: 'static', content: 'Space Grotesk' } },
                },
              ],
            },
          },
          node: {
            type: 'element',
            content: {
              elementType: 'container',
              style: { fontFamily: { type: 'static', content: 'Manrope, sans-serif' } },
              attrs: { fontFamily: { type: 'static', content: 'Manrope' } },
              children: [],
            },
          },
        },
        components: {
          Card: {
            name: 'Card',
            node: {
              type: 'element',
              content: {
                elementType: 'container',
                referencedStyles: {
                  r1: {
                    type: 'style-map',
                    content: {
                      mapType: 'inlined',
                      conditions: [{ conditionType: 'screen-size', maxWidth: 479 }],
                      styles: { fontFamily: { type: 'static', content: '"Space Grotesk"' } },
                    },
                  },
                },
              },
            },
          },
        },
      } as unknown as ProjectUIDL)

    it('names the stand-in in every font stack and adds its @font-face once', () => {
      const uidl = project()
      applyFontFallbacks(uidl)
      const root = uidl.root as unknown as Record<string, any>

      expect(root.node.content.style.fontFamily.content).toBe(
        'Manrope, Manrope Fallback, sans-serif'
      )
      expect(root.node.content.attrs.fontFamily.content).toBe('Manrope')
      expect(root.styleSetDefinitions.heading.content.fontFamily.content).toBe(
        'Manrope, Manrope Fallback'
      )
      expect(root.styleSetDefinitions.heading.conditions[0].content.fontFamily.content).toBe(
        'Space Grotesk, Space Grotesk Fallback'
      )
      expect(root.designLanguage.tokens['--font-heading'].content).toBe('Manrope, Manrope Fallback')
      expect(
        (uidl.components.Card as unknown as Record<string, any>).node.content.referencedStyles.r1
          .content.styles.fontFamily.content
      ).toBe('"Space Grotesk", Space Grotesk Fallback')
      expect((uidl.globals.assets[0] as { content: string }).content).toBe(
        'html { font-family: "Space Grotesk", Space Grotesk Fallback; }'
      )
      expect(uidl.globals.customCode.head).toBe(
        '<style>.post h2 { font-family: manrope, Manrope Fallback }</style><script>var font-family</script>'
      )

      const faces = uidl.globals.assets.filter(
        (asset) =>
          'attrs' in asset && asset.attrs?.['data-tag']?.content === FONT_FALLBACKS_STYLE_TAG
      )
      expect(faces).toHaveLength(1)
      expect((faces[0] as { content: string }).content).toContain('font-family: Manrope Fallback;')
      expect((faces[0] as { content: string }).content).toContain(
        'font-family: Space Grotesk Fallback;'
      )
    })

    it('leaves a project that loads no Google font untouched', () => {
      const uidl = project()
      uidl.globals.assets = uidl.globals.assets.filter((asset) => asset.type !== 'font')
      const before = JSON.stringify(uidl)
      applyFontFallbacks(uidl)
      expect(JSON.stringify(uidl)).toBe(before)
    })
  })
})
