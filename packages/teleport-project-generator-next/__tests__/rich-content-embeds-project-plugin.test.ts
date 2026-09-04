import { parse } from '@babel/parser'
import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { RichTextEmbeds, RichTextEmbedsCodegen } from '@teleporthq/teleport-shared'
import {
  NextRichContentEmbedsProjectPlugin,
  RICH_CONTENT_EMBEDS_COMPONENT_NAME,
  RICH_CONTENT_EMBEDS_FILE_NAME,
} from '../src/rich-content-embeds/project-plugin'
import { EMBED_RUNTIME_FILE_NAME } from '../src/rich-content-embeds/runtime-module'

const APP_CONTENT = `import '../style.css'

const MyApp = ({ Component, pageProps }) => {
  return (
    <Component {...pageProps} />
  )
}

export default MyApp
`

const element = (elementType: string, extra: Record<string, unknown> = {}) => ({
  type: 'element',
  content: { elementType, children: [] as unknown[], ...extra },
})

/** The blog details page's Content node: `html` raw, carrying a ctx binding. */
const boundRichTextNode = () =>
  element('html-node', {
    attrs: {
      html: {
        type: 'raw',
        content: '<p>Blog post content...</p>',
        fallback: '<p>Blog post content...</p>',
        dynamic: { type: 'dynamic', content: { referenceType: 'prop', id: 'content' } },
      },
    },
  })

/** A design-time code embed: the same attribute, but with no binding. */
const staticEmbedNode = () =>
  element('html-node', {
    attrs: { html: { type: 'raw', content: '<div>hello</div>' } },
  })

const makeStructure = (pageChild: unknown): ProjectPluginStructure => {
  const files = new Map()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })

  return {
    uidl: {
      name: 'test-project',
      globals: { settings: { title: 'Test', language: 'en' }, assets: [] },
      root: { node: element('container') },
      components: {
        'blog-post-details': { node: element('container', { children: [pageChild] }) },
      },
    },
    files,
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

const emittedComponent = (structure: ProjectPluginStructure): string | undefined =>
  structure.files.get(RICH_CONTENT_EMBEDS_FILE_NAME)?.files[0]?.content as string | undefined

const emittedRuntime = (structure: ProjectPluginStructure): string | undefined =>
  structure.files.get(EMBED_RUNTIME_FILE_NAME)?.files[0]?.content as string | undefined

const appContent = (structure: ProjectPluginStructure): string =>
  (structure.files.get('_app')?.files[0]?.content as string) ?? ''

describe('NextRichContentEmbedsProjectPlugin', () => {
  it('ships the activator and mounts it in _app when a page renders bound rich text', async () => {
    const structure = await new NextRichContentEmbedsProjectPlugin().runAfter(
      makeStructure(boundRichTextNode())
    )

    expect(emittedComponent(structure)).toContain('export default RichContentEmbeds')
    expect(appContent(structure)).toContain(
      `import ${RICH_CONTENT_EMBEDS_COMPONENT_NAME} from '../components/${RICH_CONTENT_EMBEDS_FILE_NAME}';`
    )
    expect(appContent(structure)).toContain(`<${RICH_CONTENT_EMBEDS_COMPONENT_NAME} />`)
  })

  it('also ships it for CMS rich text rendered through a markdown node', async () => {
    const structure = await new NextRichContentEmbedsProjectPlugin().runAfter(
      makeStructure(element('div', { semanticType: 'markdown-node' }))
    )

    expect(emittedComponent(structure)).toBeDefined()
  })

  it('ships nothing for an editor alone — it previews its own embeds', async () => {
    const structure = await new NextRichContentEmbedsProjectPlugin().runAfter(
      makeStructure(element('RichTextEditor', { semanticType: 'rich-text-editor-node' }))
    )

    expect(emittedComponent(structure)).toBeUndefined()
  })

  it('ships nothing for a project with no author-written rich text', async () => {
    const structure = await new NextRichContentEmbedsProjectPlugin().runAfter(
      makeStructure(staticEmbedNode())
    )

    expect(emittedComponent(structure)).toBeUndefined()
    expect(appContent(structure)).toBe(APP_CONTENT)
  })

  it('adds no npm dependency', async () => {
    const structure = await new NextRichContentEmbedsProjectPlugin().runAfter(
      makeStructure(boundRichTextNode())
    )

    expect(structure.dependencies).toEqual({})
    expect(structure.devDependencies).toEqual({})
  })

  it('is idempotent — a second pass does not mount the component twice', async () => {
    const plugin = new NextRichContentEmbedsProjectPlugin()
    const once = await plugin.runAfter(makeStructure(boundRichTextNode()))
    const twice = await plugin.runAfter(once)

    expect(appContent(twice).match(/RichContentEmbeds/g)).toHaveLength(2)
  })

  it('ships the shared runtime module beside the activator', async () => {
    const structure = await new NextRichContentEmbedsProjectPlugin().runAfter(
      makeStructure(boundRichTextNode())
    )

    expect(emittedRuntime(structure)).toBe(RichTextEmbedsCodegen.generateEmbedRuntimeModuleSource())
    expect(emittedComponent(structure)).toContain(`from './${EMBED_RUNTIME_FILE_NAME}'`)
  })

  it('imports only helpers the runtime module actually exports', async () => {
    const structure = await new NextRichContentEmbedsProjectPlugin().runAfter(
      makeStructure(boundRichTextNode())
    )
    const source = emittedComponent(structure) as string
    const runtime = emittedRuntime(structure) as string

    const importBlock = source.match(
      new RegExp(`import \\{([^}]+)\\} from '\\./${EMBED_RUNTIME_FILE_NAME}'`)
    )
    expect(importBlock).not.toBeNull()

    const imported = (importBlock as RegExpMatchArray)[1]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    expect(imported.length).toBeGreaterThan(0)

    imported.forEach((name) => {
      expect(runtime).toMatch(new RegExp(`^export (?:var|function) ${name}\\b`, 'm'))
    })
  })

  it('emits a component that parses as a module', async () => {
    const structure = await new NextRichContentEmbedsProjectPlugin().runAfter(
      makeStructure(boundRichTextNode())
    )

    expect(() =>
      parse(emittedComponent(structure) as string, { sourceType: 'module', plugins: ['jsx'] })
    ).not.toThrow()
  })

  it('never leaves the sandbox flags open to the host page by default', async () => {
    const structure = await new NextRichContentEmbedsProjectPlugin().runAfter(
      makeStructure(boundRichTextNode())
    )
    const source = emittedComponent(structure) as string

    // `allow-same-origin` may only reach the DOM through the shared resolver,
    // driven by the per-embed opt-in — never as a literal in the wiring, and
    // never as the default when the attribute is missing or misspelled.
    expect(source).not.toContain('allow-same-origin')
    expect(source).toContain('resolveEmbedSandboxFlags(level)')
    expect(source).toContain(
      "block.getAttribute(EMBED_ATTR.SANDBOX) === 'trusted' ? 'trusted' : 'strict'"
    )
  })
})
