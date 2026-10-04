import { existsSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { load } from 'cheerio'
import { ProjectType, PublisherType } from '@teleporthq/teleport-types'
import {
  plainSite,
  stateSite,
} from '../../teleport-project-generator-html/__tests__/_helpers/state-site'
import { packProject } from '../src/index'

/**
 * The HTML download goes through `packProject`, which clears the generator's
 * plugins and lists the HTML ones by hand, so the state runtime is checked on
 * the path the editor's download takes (strict whitespace on, as by default).
 */
const outputPath = join(__dirname, 'packproject-html-state-tmp')

afterAll(() => {
  rmSync(outputPath, { recursive: true, force: true })
})

const download = async (projectSlug: string, uidl = stateSite()) => {
  const { success } = await packProject(uidl, {
    projectType: ProjectType.HTML,
    publisher: PublisherType.DISK,
    publishOptions: { outputPath, projectSlug },
  })
  expect(success).toBeTruthy()
  return join(outputPath, projectSlug)
}

describe('packProject, HTML: a downloaded site runs its conditions and clicks', () => {
  it('writes tq-state.js next to the stylesheet and links it from the page that binds state', async () => {
    const root = await download('state-html-site')

    expect(existsSync(join(root, 'tq-state.js'))).toBe(true)
    const home = readFileSync(join(root, 'index.html'), 'utf8')
    expect(home.match(/<script defer src="\.\/tq-state\.js"><\/script>/g)).toHaveLength(1)
    expect(home.search(/tq-state\.js/)).toBeLessThan(home.search(/<\/head\s*>/))

    const $ = load(home)
    expect($('#burger').first().attr('data-tq-on-click')).toBe('menuOpen = !menuOpen')
    expect($('#tab-1').attr('data-tq-on-click')).toBe('activeTabIndex = 1')
    expect($('#panel-1').attr('hidden')).toBeDefined()
    expect($('#panel-0').attr('hidden')).toBeUndefined()
    expect(readFileSync(join(root, 'style.css'), 'utf8')).toContain(
      '[data-tq-if][hidden] {\n  display: none !important;\n}'
    )
  })

  it('a site without state bindings downloads as it did before', async () => {
    const root = await download('plain-html-site', plainSite())

    expect(readdirSync(root)).not.toContain('tq-state.js')
    expect(readFileSync(join(root, 'index.html'), 'utf8')).not.toContain('tq-state')
    expect(readFileSync(join(root, 'style.css'), 'utf8')).not.toContain('data-tq-if')
  })
})
