import { FileType, ProjectUIDL } from '@teleporthq/teleport-types'
import { createHTMLProjectGenerator, pluginCloneGlobals, pluginHomeReplace } from '../src'
import uidlSample from '../../../examples/test-samples/comp-style-overrides.json'

describe('Google fonts get a size-matched stand-in in the generated HTML project', () => {
  it('declares the stand-in in the page head and names it after the font', async () => {
    const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
    uidl.globals.assets.push(
      { type: 'font', path: 'https://fonts.googleapis.com/css2?family=Roboto&display=swap' },
      { type: 'style', content: "body{font-family: 'Roboto', sans-serif;}" }
    )
    uidl.root.styleSetDefinitions = {
      ...uidl.root.styleSetDefinitions,
      'brand-heading': {
        type: 'reusable-project-style-map',
        content: { fontFamily: 'Roboto' },
      } as never,
    }
    const generator = createHTMLProjectGenerator()
    generator.addPlugin(pluginHomeReplace)
    generator.addPlugin(pluginCloneGlobals)
    const { files } = await generator.generateProject(uidl)

    const html = files.filter((file) => file.fileType === FileType.HTML).map((file) => file.content)
    const css = files.filter((file) => file.fileType === FileType.CSS).map((file) => file.content)

    expect(html.length).toBeGreaterThan(0)
    for (const page of html) {
      expect(page).toContain('font-family: Roboto Fallback;')
      expect(page).toContain("font-family: 'Roboto', Roboto Fallback, sans-serif;")
    }
    expect(css.join('\n')).toMatch(/brand-heading\s*\{[^}]*font-family: Roboto, Roboto Fallback;/)
  })
})
