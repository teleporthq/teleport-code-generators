import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { NextDashboardLayoutPlugin } from '../src/dashboard-layout-plugin'

function makeStructure(pageLayoutMode?: string): ProjectPluginStructure {
  return {
    uidl: {
      name: 'test-project',
      globals: { settings: { title: 'Test', language: 'en' }, assets: [] },
      root: {} as never,
      ...(pageLayoutMode ? { pageLayoutMode } : {}),
    },
    files: new Map(),
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

function getDashboardCss(structure: ProjectPluginStructure): string {
  const entry = structure.files.get('projectStyleSheet')
  const cssFile = entry?.files.find((f) => f.fileType === FileType.CSS || f.fileType === 'css')
  return (cssFile?.content as string) ?? ''
}

describe('NextDashboardLayoutPlugin', () => {
  it('does nothing when pageLayoutMode is not "dashboard"', async () => {
    const plugin = new NextDashboardLayoutPlugin()
    const structure = makeStructure('standard')

    await plugin.runAfter(structure)

    expect(structure.files.has('projectStyleSheet')).toBe(false)
  })

  it('injects the dashboard layout CSS when pageLayoutMode is "dashboard"', async () => {
    const plugin = new NextDashboardLayoutPlugin()
    const structure = makeStructure('dashboard')

    await plugin.runAfter(structure)

    const css = getDashboardCss(structure)
    expect(css).toContain('.teleport-dashboard-layout')
    expect(css).toContain('.teleport-dashboard-sidebar')
  })

  /**
   * Bug 7 regression — see the long-form rationale comment above
   * `.teleport-dashboard-sidebar nav` in dashboard-layout-plugin.ts: a
   * `max-height` alone leaves the AI-authored nav auto/content-sized
   * (verified live via a minimal repro to stay exactly content-sized, never
   * capped-and-filled), and a `min-height: 100%` companion unconditionally
   * wins over `max-height: 100vh` per the CSS min/max resolution order once
   * the outer stretched sidebar is taller than one viewport — silently
   * un-capping the nav again on exactly the long-page case this fix targets.
   * Only a definite `height: 100vh` (with no competing min/max-height on the
   * same rule) fixes both the visual gap and lets the AI's own inner
   * `height: 100%` mode-wrapper resolve against a real value.
   */
  it('forces a definite height: 100vh on the sidebar nav (not max-height, not min-height)', async () => {
    const plugin = new NextDashboardLayoutPlugin()
    const structure = makeStructure('dashboard')

    await plugin.runAfter(structure)

    const css = getDashboardCss(structure)
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const navBlock =
      withoutComments.match(/\.teleport-dashboard-sidebar nav\s*\{[^}]*\}/)?.[0] ?? ''

    expect(navBlock).not.toEqual('')
    expect(navBlock).toMatch(/height:\s*100vh/)
    expect(navBlock).not.toMatch(/max-height/)
    expect(navBlock).not.toMatch(/min-height/)
    expect(navBlock).toMatch(/position:\s*sticky/)
    expect(navBlock).toMatch(/top:\s*0/)
    expect(navBlock).toMatch(/overflow-y:\s*auto/)
  })

  it('appends to an existing stylesheet file instead of overwriting it', async () => {
    const plugin = new NextDashboardLayoutPlugin()
    const structure = makeStructure('dashboard')
    structure.files.set('projectStyleSheet', {
      path: ['pages'],
      files: [{ name: 'style', fileType: FileType.CSS, content: '.existing { color: red; }' }],
    })

    await plugin.runAfter(structure)

    const css = getDashboardCss(structure)
    expect(css).toContain('.existing')
    expect(css).toContain('.teleport-dashboard-layout')
  })
})
