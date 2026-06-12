import { FileType, InMemoryFileRecord, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { NextCalendarKitProjectPlugin } from '../src/calendar/project-plugin'
import { CALENDARKIT_CSS } from '../src/calendar/calendarkit-css'

const APP_CONTENT = `import './style.css'

export default function MyApp({ Component, pageProps }) {
  return <Component {...pageProps} />
}
`

const buildStructure = (
  dependencies: Record<string, string>,
  withAppFile = true
): ProjectPluginStructure => {
  const files = new Map<string, InMemoryFileRecord>()
  if (withAppFile) {
    files.set('_app', {
      path: ['pages'],
      files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
    })
  }

  return {
    files,
    dependencies,
    devDependencies: {},
  } as unknown as ProjectPluginStructure
}

describe('NextCalendarKitProjectPlugin', () => {
  const plugin = new NextCalendarKitProjectPlugin()

  it('is a no-op for projects without calendarkit-basic', async () => {
    const structure = buildStructure({ react: '^17.0.2' })

    await plugin.runAfter(structure)

    expect(structure.dependencies.react).toBe('^17.0.2')
    expect(structure.files.has('calendarkit-css')).toBe(false)
    const appFile = structure.files.get('_app')?.files[0]
    expect(appFile?.content).toBe(APP_CONTENT)
  })

  it('bumps react/react-dom, writes the stylesheet and imports it from _app', async () => {
    const structure = buildStructure({
      react: '^17.0.2',
      'react-dom': '^17.0.2',
      'calendarkit-basic': '1.1.0',
    })

    await plugin.runAfter(structure)

    expect(structure.dependencies.react).toBe('^18.3.1')
    expect(structure.dependencies['react-dom']).toBe('^18.3.1')

    const cssRecord = structure.files.get('calendarkit-css')
    expect(cssRecord?.path).toEqual(['pages'])
    expect(cssRecord?.files[0]).toEqual({
      name: 'calendarkit',
      fileType: FileType.CSS,
      content: CALENDARKIT_CSS,
    })

    const appContent = structure.files.get('_app')?.files[0].content as string
    expect(appContent).toContain("import './calendarkit.css'")
    expect(appContent.indexOf("import './calendarkit.css'")).toBeLessThan(
      appContent.indexOf("import './style.css'")
    )
  })

  it('is idempotent when run twice', async () => {
    const structure = buildStructure({ 'calendarkit-basic': '1.1.0' })

    await plugin.runAfter(structure)
    await plugin.runAfter(structure)

    const appContent = structure.files.get('_app')?.files[0].content as string
    expect(appContent.match(/import '\.\/calendarkit\.css'/g)).toHaveLength(1)
  })

  it('still adds the stylesheet when no _app file exists', async () => {
    const structure = buildStructure({ 'calendarkit-basic': '1.1.0' }, false)

    await plugin.runAfter(structure)

    expect(structure.files.has('calendarkit-css')).toBe(true)
    expect(structure.dependencies.react).toBe('^18.3.1')
  })

  it('ships CSS with no tailwind directives and no global resets', () => {
    expect(CALENDARKIT_CSS).not.toContain('@tailwind')
    expect(CALENDARKIT_CSS).not.toMatch(/(^|\})\*\{/)
    expect(CALENDARKIT_CSS).not.toMatch(/(^|\})body\{/)
    expect(CALENDARKIT_CSS).toContain(':root')
    expect(CALENDARKIT_CSS).toContain('.dark')
    expect(CALENDARKIT_CSS).toContain('grid-cols-7')
  })
})
