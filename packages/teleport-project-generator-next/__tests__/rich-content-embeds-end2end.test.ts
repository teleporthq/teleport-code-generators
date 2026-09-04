import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import { RichTextEmbedsCodegen } from '@teleporthq/teleport-shared'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'
import { generateRichTextEditorComponentCode } from '../src/rich-text-editor/component-generator'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

/**
 * The blog post details page's Content node, as the GUI emits it: an
 * `html-node` whose `html` raw attribute carries a binding to the post's body.
 * This is the node that becomes `<span dangerouslySetInnerHTML>` — the one
 * place a code embed's `<script>` cannot run on its own.
 */
const BOUND_RICH_TEXT_NODE = {
  type: 'element',
  content: {
    elementType: 'html-node',
    name: 'Content',
    children: [],
    attrs: {
      html: {
        type: 'raw',
        content: '<p>Blog post content...</p>',
        fallback: '<p>Blog post content...</p>',
        dynamic: {
          type: 'dynamic',
          content: { referenceType: 'prop', id: 'post', refPath: ['content'] },
        },
      },
    },
  },
}

/** The admin blog form's Content field, with the embed format enabled. */
const embedEnabledEditorNode = (formats: string[]) => ({
  type: 'element',
  content: {
    elementType: 'rich-text-editor-node',
    name: 'ContentRichTextEditor',
    children: [],
    attrs: {
      name: { type: 'static', content: 'content' },
      quillTheme: { type: 'static', content: 'snow' },
      quillFormats: { type: 'raw', content: JSON.stringify(formats) },
      html: { type: 'raw', content: '' },
    },
  },
})

const findFile = (folder: GeneratedFolder, folderName: string, fileName: string) =>
  folder.subFolders
    .find((sub) => sub.name === folderName)
    ?.files.find((file) => file.name === fileName)

const buildUidl = (nodes: unknown[]): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(...nodes)
  return uidl
}

describe('Next generator with code embeds in rich-text content', () => {
  const generator = createNextProjectGenerator()

  it('ships the runtime and mounts the activator for a page that binds rich text', async () => {
    const outputFolder = await generator.generateProject(
      buildUidl([BOUND_RICH_TEXT_NODE]),
      template
    )

    const runtime = findFile(outputFolder, 'components', 'embed-runtime')
    expect(runtime?.content).toBe(RichTextEmbedsCodegen.generateEmbedRuntimeModuleSource())

    const activator = findFile(outputFolder, 'components', 'rich-content-embeds')
    expect(activator?.content).toContain("from './embed-runtime'")
    expect(activator?.content).toContain('export default RichContentEmbeds')

    const appFile = findFile(outputFolder, 'pages', '_app')
    expect(appFile?.content).toContain(
      "import RichContentEmbeds from '../components/rich-content-embeds'"
    )
    expect(appFile?.content).toContain('<RichContentEmbeds />')
  })

  it('leaves the bound content rendering exactly as it did before', async () => {
    const outputFolder = await generator.generateProject(
      buildUidl([BOUND_RICH_TEXT_NODE]),
      template
    )
    const indexPage = findFile(outputFolder, 'pages', 'index')

    // The markup is untouched: the activator is additive, so a project that
    // predates embeds renders byte-for-byte what it always did.
    expect(indexPage?.content).toContain('dangerouslySetInnerHTML')
    expect(indexPage?.content).toContain('<p>Blog post content...</p>')
    expect(indexPage?.content).not.toContain('dangerous-html')
  })

  it('adds no npm dependency for the embed layer', async () => {
    const outputFolder = await generator.generateProject(
      buildUidl([BOUND_RICH_TEXT_NODE]),
      template
    )
    const packageJson = JSON.parse(
      outputFolder.files.find((file) => file.name === 'package')?.content || '{}'
    )

    expect(Object.keys(packageJson.dependencies)).not.toContain('dangerous-html')
    expect(JSON.stringify(packageJson)).not.toContain('embed')
  })

  it('ships nothing at all for a project with no author-written rich text', async () => {
    const outputFolder = await generator.generateProject(buildUidl([]), template)

    expect(findFile(outputFolder, 'components', 'embed-runtime')).toBeUndefined()
    expect(findFile(outputFolder, 'components', 'rich-content-embeds')).toBeUndefined()
    expect(findFile(outputFolder, 'pages', '_app')?.content).not.toContain('RichContentEmbeds')
  })

  it('wires the admin editor for embeds when a field enables the format', async () => {
    const outputFolder = await generator.generateProject(
      buildUidl([embedEnabledEditorNode(['bold', 'link', 'tq-embed'])]),
      template
    )

    const editor = findFile(outputFolder, 'components', 'rich-text-editor')
    expect(editor?.content).toContain("from './embed-runtime'")
    expect(editor?.content).toContain('registerEmbedBlot')
    expect(editor?.content).toContain('EmbedDialog')
    expect(editor?.content).toContain('normalizeEmbedsInEditorHtml')

    const indexPage = findFile(outputFolder, 'pages', 'index')
    expect(indexPage?.content).toContain('quillFormats')
    expect(indexPage?.content).toContain("'tq-embed'")

    // The editor and the activator share one runtime module, shipped once.
    expect(findFile(outputFolder, 'components', 'embed-runtime')?.content).toBe(
      RichTextEmbedsCodegen.generateEmbedRuntimeModuleSource()
    )
  })

  it('leaves an editor without the format exactly as it was generated before', async () => {
    const outputFolder = await generator.generateProject(
      buildUidl([embedEnabledEditorNode(['bold', 'link'])]),
      template
    )

    expect(findFile(outputFolder, 'components', 'rich-text-editor')?.content).toBe(
      generateRichTextEditorComponentCode()
    )
    expect(findFile(outputFolder, 'components', 'embed-runtime')).toBeUndefined()
  })
})
