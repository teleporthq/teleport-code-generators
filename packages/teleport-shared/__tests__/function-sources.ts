import * as path from 'path'
import { MANIFEST, renderSources } from '../../../scripts/function-sources'

/**
 * The runtime helpers that ship as text inside generated projects are derived
 * from their typed sources by scripts/function-sources.js. A generated module
 * that is older than its source would ship yesterday's helper; this fails
 * until `node scripts/function-sources.js` has been run again.
 */
describe('generated helper sources', () => {
  const root = path.resolve(__dirname, '../../..')

  for (const entry of MANIFEST) {
    it(`${entry.output} is current`, () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const generated = require(path.join(root, entry.output))[entry.exportName]
      expect(generated).toEqual(Object.fromEntries(renderSources(entry)))
    })
  }

  it('carries every helper under its own name, so the emitted text calls them by name', () => {
    for (const entry of MANIFEST) {
      for (const [name, text] of renderSources(entry)) {
        expect(
          text.startsWith(`function ${name}(`) || text.startsWith(`async function ${name}(`)
        ).toBe(true)
      }
    }
  })
})
