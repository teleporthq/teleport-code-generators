/**
 * Builds packages/teleport-project-generator/src/font-fallbacks/google-font-fallbacks.generated.ts:
 * for every Google font, how to dress a font every visitor already has (Arial,
 * Times New Roman, Courier New) so that text set in it takes the same room as
 * the Google font will once it arrives. See font-fallbacks/index.ts for why.
 *
 *   node scripts/measure-google-font-fallbacks.mjs [--only "Family A,Family B"] [--out <file>]
 *
 * Every number is measured in Chromium from the fonts Google serves today:
 * each family is loaded (subset to the sample's letters) next to the
 * metric-compatible twin of the stand-in (Arimo = Arial, Tinos = Times New
 * Roman, Cousine = Courier New), and the script records the width of the same
 * text in both and the family's ascent, descent and line gap. Published tables
 * (next@12.3's google-font-metrics.json) were tried first: their widths miss
 * real text by up to 7%, and fonts updated since (Inter, DM Sans, Poppins) have
 * different heights now, so a page would still re-wrap and move.
 *
 * Needs network access and `playwright-core` (set PLAYWRIGHT_CORE to its
 * directory when it is not installed here).
 */
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core')

const args = process.argv.slice(2)
const flag = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
const familyKey = (family) => family.toLowerCase().replace(/\s+/g, '')
const only = flag('--only')
  ?.split(',')
  .map((family) => familyKey(family.trim()))
const out =
  flag('--out') ||
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../packages/teleport-project-generator/src/font-fallbacks/google-font-fallbacks.generated.ts'
  )

// Ordinary website copy, mostly running prose: paragraphs are where a width
// mismatch re-wraps lines and moves the page, so they set the average. A few
// headings, numbers and punctuation keep it honest for the rest.
const SAMPLE_TEXT = [
  'Build your website in minutes',
  'We started this company because buying good coffee online was harder than it should have been. Every bag we sell is roasted the week you order it, packed by hand and shipped straight from our small workshop to your door.',
  'Our team works with farmers we know by name. We visit them every year, pay well above the market price and share what we learn with the people who drink it, so you always know where your morning cup comes from.',
  'Choose a plan that suits you, change it whenever you like and cancel at any time. If something is not right with your order, write to us and we will make it right, usually within a day.',
  'Free shipping on orders over $50, 30-day returns and questions answered at (555) 012-3456.',
  'Sign up for our newsletter to get brewing tips, news and offers in your inbox once a week.',
].join(' ')

// The stand-in each category is matched against, by its metric-compatible twin.
const REFERENCE_BY_CATEGORY = { Serif: 'Tinos', Monospace: 'Cousine' }
const DEFAULT_REFERENCE = 'Arimo'
const REFERENCES = ['Arimo', 'Tinos', 'Cousine']

const loadGoogleFamilies = async () => {
  const response = await fetch('https://fonts.google.com/metadata/fonts')
  const text = await response.text()
  const { familyMetadataList } = JSON.parse(text.slice(text.indexOf('{')))
  return familyMetadataList
    .filter((font) => font.subsets.includes('latin'))
    .map((font) => ({
      family: font.family,
      reference: REFERENCE_BY_CATEGORY[font.category] || DEFAULT_REFERENCE,
      // The regular weight is what running text uses; a family without one is
      // measured at the first upright weight it has.
      weight:
        '400' in font.fonts
          ? 400
          : Number(Object.keys(font.fonts).find((style) => /^\d+$/.test(style))),
    }))
    .filter((font) => Number.isFinite(font.weight))
}

const sampleGlyphs = encodeURIComponent([...new Set(SAMPLE_TEXT + 'Hxgy')].join(''))

const measureBatch = async (page, fonts) => {
  const links = fonts
    .map(
      ({ family, weight }) =>
        `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(
          family
        )}:wght@${weight}&text=${sampleGlyphs}">`
    )
    .join('')
  await page.setContent(links, { waitUntil: 'networkidle' })
  return page.evaluate(
    async ({ fonts, sample }) => {
      const canvas = document.createElement('canvas').getContext('2d')
      const line = document.createElement('div')
      line.textContent = 'Hxgy'
      document.body.appendChild(line)
      const result = {}
      for (const { family, weight } of fonts) {
        try {
          await document.fonts.load(`${weight} 100px "${family}"`, sample)
        } catch (error) {
          continue
        }
        const loaded = [...document.fonts].some(
          (face) => face.family.replace(/^["']|["']$/g, '') === family && face.status === 'loaded'
        )
        if (!loaded) {
          continue
        }
        canvas.font = `${weight} 100px "${family}"`
        const width = canvas.measureText(sample).width / 100
        canvas.font = `${weight} 1000px "${family}"`
        const box = canvas.measureText('Hxgy')
        line.style.font = `${weight} 1000px/normal "${family}"`
        const normalLineHeight = line.getBoundingClientRect().height / 1000
        const ascent = box.fontBoundingBoxAscent / 1000
        const descent = box.fontBoundingBoxDescent / 1000
        result[family] = {
          width,
          ascent,
          descent,
          lineGap: Math.max(0, normalLineHeight - ascent - descent),
        }
      }
      return result
    },
    { fonts, sample: SAMPLE_TEXT }
  )
}

const main = async () => {
  const fonts = (await loadGoogleFamilies()).filter(
    ({ family }) => !only || only.includes(familyKey(family))
  )
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const measured = await measureBatch(
    page,
    REFERENCES.map((family) => ({ family, weight: 400 }))
  )
  const BATCH = 20
  for (let at = 0; at < fonts.length; at += BATCH) {
    Object.assign(measured, await measureBatch(page, fonts.slice(at, at + BATCH)))
    process.stderr.write(`\r${Math.min(at + BATCH, fonts.length)}/${fonts.length}`)
  }
  process.stderr.write('\n')
  await browser.close()

  const round = (value) => Number(value.toFixed(4))
  const entries = []
  const skipped = []
  for (const { family, reference } of [...fonts].sort((a, b) =>
    familyKey(a.family).localeCompare(familyKey(b.family))
  )) {
    const own = measured[family]
    if (!own || !measured[reference]) {
      skipped.push(family)
      continue
    }
    const sizeAdjust = own.width / measured[reference].width
    entries.push(
      `  ${JSON.stringify(familyKey(family))}: [${JSON.stringify(reference)}, ${round(
        sizeAdjust
      )}, ${round(own.ascent / sizeAdjust)}, ${round(own.descent / sizeAdjust)}, ${round(
        own.lineGap / sizeAdjust
      )}],`
    )
  }

  const source = `// Generated by scripts/measure-google-font-fallbacks.mjs. Do not edit: rerun the script.
//
// Per Google font (key: the family name lower-cased, spaces removed): the
// stand-in's metric-compatible twin, then size-adjust, ascent-override,
// descent-override and line-gap-override as fractions of the font size —
// measured in Chromium from the fonts Google serves.
/* tslint:disable */
/* eslint-disable */
export type FallbackReference = 'Arimo' | 'Tinos' | 'Cousine'
export type GoogleFontFallbackMetrics = [FallbackReference, number, number, number, number]

export const GOOGLE_FONT_FALLBACK_METRICS: Record<string, GoogleFontFallbackMetrics> = {
${entries.join('\n')}
}
`
  // Written the way the repo's formatter writes it, so a rerun only shows real changes.
  const prettier = require('prettier')
  const prettierConfig = (await prettier.resolveConfig(fileURLToPath(import.meta.url))) || {}
  writeFileSync(out, prettier.format(source, { ...prettierConfig, parser: 'typescript' }))
  console.log(`wrote ${entries.length} families to ${out}`)
  if (skipped.length) {
    console.log(`skipped ${skipped.length} that did not load: ${skipped.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
