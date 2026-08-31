import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

/**
 * The shape the GUI's audio-to-uidl converter emits: a plain native `audio`
 * element (no wrapper, no semanticType) whose boolean attributes are
 * presence-only — 'true' survives, 'false' and empty strings are stripped
 * before the UIDL leaves the editor, so every target gets correct presence
 * semantics (plain HTML would treat controls="false" as ON).
 */
const AUDIO_NODE = {
  type: 'element',
  content: {
    elementType: 'audio',
    name: 'audio1',
    attrs: {
      src: {
        type: 'static',
        content: 'https://storage.googleapis.com/kenney/audio/ui-audio/click1.mp3',
      },
      controls: { type: 'static', content: 'true' },
      loop: { type: 'static', content: 'true' },
    },
    style: {
      width: { type: 'static', content: '100%' },
    },
    children: [],
  },
}

const buildUidlWithAudio = (): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(AUDIO_NODE)
  return uidl
}

describe('Next generator with a native audio element', () => {
  const generator = createNextProjectGenerator()

  it('renders <audio> with React boolean props and the remote src verbatim', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithAudio(), template)

    const indexPage = outputFolder.subFolders
      .find((sub) => sub.name === 'pages')
      ?.files.find((file) => file.name === 'index')

    expect(indexPage?.content).toContain('<audio')
    // Hotlinked CDN srcs must never be rewritten to local asset paths.
    expect(indexPage?.content).toContain(
      'src="https://storage.googleapis.com/kenney/audio/ui-audio/click1.mp3"'
    )
    // 'true' strings become bare JSX boolean attributes (REACT_BOOLEAN_DOM_PROPS),
    // never the string "true" React would pass through, and never ="false".
    expect(indexPage?.content).toMatch(/<audio[^>]*\scontrols[\s>]/)
    expect(indexPage?.content).not.toContain('controls="true"')
    expect(indexPage?.content).toMatch(/<audio[^>]*\sloop[\s>]/)
    expect(indexPage?.content).not.toContain('loop="true"')

    // A native element pulls in no dependency and no project plugin output.
    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    const dependencyNames = Object.keys(packageJson.dependencies || {})
    expect(dependencyNames.some((name) => name.includes('audio'))).toBe(false)
  })
})
