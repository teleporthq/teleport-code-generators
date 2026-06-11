import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

// The production template (react ^17) — the same one the GUI publish path
// feeds into packProject, so the react bump is asserted against real deps.
const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const CALENDAR_ELEMENT_NODE = {
  type: 'element',
  content: {
    elementType: 'BasicScheduler',
    name: 'calendar',
    dependency: {
      type: 'package',
      path: 'calendarkit-basic',
      version: '1.1.0',
      meta: { namedImport: true },
    },
    attrs: {
      view: { type: 'static', content: 'month' },
      weekStartsOn: { type: 'static', content: 1 },
      events: {
        type: 'static',
        content: [
          {
            id: '1',
            title: 'Team Meeting',
            start: '2026-06-15T09:00:00',
            end: '2026-06-15T10:30:00',
          },
        ],
      },
    },
    children: [],
  },
}

const buildUidlWithCalendar = (): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(CALENDAR_ELEMENT_NODE)
  return uidl
}

const findFile = (folder: GeneratedFolder, folderName: string, fileName: string) =>
  folder.subFolders
    .find((sub) => sub.name === folderName)
    ?.files.find((file) => file.name === fileName)

describe('Next generator with a CalendarKit calendar element', () => {
  const generator = createNextProjectGenerator()

  it('generates the calendar page, bumps react and ships the precompiled stylesheet', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithCalendar(), template)

    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    expect(packageJson.dependencies['calendarkit-basic']).toBe('1.1.0')
    expect(packageJson.dependencies.react).toBe('^18.3.1')
    expect(packageJson.dependencies['react-dom']).toBe('^18.3.1')
    expect(packageJson.dependencies.next).toBe('^12.1.10')

    const indexPage = findFile(outputFolder, 'pages', 'index')
    expect(indexPage?.content).toContain("import { BasicScheduler } from 'calendarkit-basic'")
    expect(indexPage?.content).toContain('new Date(e.start)')
    expect(indexPage?.content).toContain('new Date(e.end)')

    const cssFile = findFile(outputFolder, 'pages', 'calendarkit')
    expect(cssFile?.fileType).toBe('css')
    expect(cssFile?.content).toContain(':root')
    expect(cssFile?.content).not.toContain('@tailwind')

    const appFile = findFile(outputFolder, 'pages', '_app')
    expect(appFile?.content).toContain("import './calendarkit.css'")
  })

  it('leaves react untouched for projects without a calendar', async () => {
    const outputFolder = await generator.generateProject(
      JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL,
      template
    )

    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    expect(packageJson.dependencies['calendarkit-basic']).toBeUndefined()
    expect(packageJson.dependencies.react).toBe('^17.0.2')

    const pagesFolder = outputFolder.subFolders.find((sub) => sub.name === 'pages')
    expect(pagesFolder?.files.find((file) => file.name === 'calendarkit')).toBeUndefined()
  })
})
