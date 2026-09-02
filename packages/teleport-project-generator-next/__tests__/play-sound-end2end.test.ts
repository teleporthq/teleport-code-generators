import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

/**
 * The shape the GUI's inspector writes for "Play sound on": three data-*
 * attributes on an ordinary element (text/button/container). The src is
 * either an uploaded-asset path (rewritten by the GUI before export) or a
 * hotlinked sound-library URL — both are plain strings by the time codegen
 * sees them.
 */
const BUTTON_WITH_SOUND = {
  type: 'element',
  content: {
    elementType: 'button',
    name: 'soundbutton',
    attrs: {
      'data-tq-sound-src': {
        type: 'static',
        content: 'https://storage.googleapis.com/kenney/audio/ui-audio/click1.mp3',
      },
      'data-tq-sound-trigger': { type: 'static', content: 'hover' },
      'data-tq-sound-volume': { type: 'static', content: '40' },
    },
    children: [{ type: 'static', content: 'Hover me' }],
  },
}

const buildUidl = (withSound: boolean): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  if (!withSound) {
    return uidl
  }
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(BUTTON_WITH_SOUND)
  return uidl
}

const findAppFile = (outputFolder: GeneratedFolder) =>
  outputFolder.subFolders
    .find((sub) => sub.name === 'pages')
    ?.files.find((file) => file.name === '_app')

const findRuntimeFile = (outputFolder: GeneratedFolder) =>
  outputFolder.subFolders
    .find((sub) => sub.name === 'utils')
    ?.files.find((file) => file.name === 'play-sound')

describe('Next generator with the play-sound interaction', () => {
  const generator = createNextProjectGenerator()

  it('keeps the data-tq-sound attrs verbatim and ships the runtime', async () => {
    const outputFolder = await generator.generateProject(buildUidl(true), template)

    const indexPage = outputFolder.subFolders
      .find((sub) => sub.name === 'pages')
      ?.files.find((file) => file.name === 'index')

    // data-* attributes must never be camelCased or dropped by the JSX emitter.
    expect(indexPage?.content).toContain(
      'data-tq-sound-src="https://storage.googleapis.com/kenney/audio/ui-audio/click1.mp3"'
    )
    expect(indexPage?.content).toContain('data-tq-sound-trigger="hover"')
    expect(indexPage?.content).toContain('data-tq-sound-volume="40"')

    // The delegated runtime ships once, imported from _app.
    const runtimeFile = findRuntimeFile(outputFolder)
    expect(runtimeFile).toBeDefined()
    expect(runtimeFile?.content).toContain('data-tq-sound-src')
    expect(runtimeFile?.content).toContain('new Audio(')
    expect(findAppFile(outputFolder)?.content).toContain("import '../utils/play-sound'")

    // No npm dependency is involved.
    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    expect(Object.keys(packageJson.dependencies || {}).some((name) => name.includes('sound'))).toBe(
      false
    )
  })

  it('ships nothing for a project without sound attributes', async () => {
    const outputFolder = await generator.generateProject(buildUidl(false), template)

    expect(findRuntimeFile(outputFolder)).toBeUndefined()
    expect(findAppFile(outputFolder)?.content ?? '').not.toContain('utils/play-sound')
  })
})
