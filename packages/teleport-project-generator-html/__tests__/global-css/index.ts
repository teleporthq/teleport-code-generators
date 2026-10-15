import { FileType, GeneratedFile, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { appendGlobalCss, appendPageScript } from '../../src/global-css'

// A page as Prettier writes it with strict whitespace (the editor's "strict
// white spacing for HTML" setting): no closing tag stands on its own.
const STRICT_PAGE = [
  '<!DOCTYPE html>',
  '<html lang="en"',
  '  ><head',
  '    ><title>Home</title',
  '  ></head',
  '  ><body',
  '    ><div>Content</div',
  '  ></body',
  '></html>',
].join('\n')

const structureWith = (page: string): ProjectPluginStructure =>
  ({
    files: new Map([
      ['index', { path: [''], files: [{ name: 'index', fileType: FileType.HTML, content: page }] }],
    ]),
  } as unknown as ProjectPluginStructure)

const pageOf = (structure: ProjectPluginStructure): string =>
  (structure.files.get('index').files as GeneratedFile[])[0].content

describe('Global CSS and page scripts in a page whose tags close the strict way', () => {
  it('a project without a stylesheet carries the CSS inside the head, after the doctype', () => {
    const structure = structureWith(STRICT_PAGE)
    appendGlobalCss(structure, '.rail { overflow: hidden; }\n')
    const page = pageOf(structure)

    expect(page.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(page.indexOf('<style>')).toBeGreaterThan(page.indexOf('<head'))
    expect(page.indexOf('.rail { overflow: hidden; }')).toBeLessThan(page.search(/<\/head\s*>/))
  })

  it('a page script runs at the end of the body', () => {
    const structure = structureWith(STRICT_PAGE)
    appendPageScript(structure, 'window.ready = true')
    const page = pageOf(structure)

    expect(page.indexOf('window.ready = true')).toBeGreaterThan(page.indexOf('<div>Content</div'))
    expect(page.indexOf('window.ready = true')).toBeLessThan(page.search(/<\/body\s*>/))
  })
})
