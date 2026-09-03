import { parse } from '@babel/parser'
import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { RichTextEmbeds, RichTextEmbedsCodegen } from '@teleporthq/teleport-shared'
import { NextRichTextEditorProjectPlugin } from '../src/rich-text-editor/project-plugin'
import { EMBED_RUNTIME_FILE_NAME } from '../src/rich-content-embeds/runtime-module'
import { generateRichTextEditorComponentCode } from '../src/rich-text-editor/component-generator'

const EMBED_FORMAT = RichTextEmbeds.EMBED_BLOT_NAME

const APP_CONTENT = `import '../style.css'

const MyApp = ({ Component, pageProps }) => {
  return (
    <Component {...pageProps} />
  )
}

export default MyApp
`

const editorNode = (formats: string[] | null) => ({
  type: 'element',
  content: {
    elementType: 'RichTextEditor',
    semanticType: 'rich-text-editor-node',
    children: [] as unknown[],
    attrs: {
      quillTheme: { type: 'static', content: 'snow' },
      ...(formats ? { quillFormats: { type: 'raw', content: JSON.stringify(formats) } } : {}),
    },
  },
})

const makeStructure = (...nodes: unknown[]): ProjectPluginStructure => {
  const files = new Map()
  files.set('_app', {
    path: ['pages'],
    files: [{ name: '_app', fileType: FileType.JS, content: APP_CONTENT }],
  })

  return {
    uidl: {
      name: 'test-project',
      globals: { settings: { title: 'Test', language: 'en' }, assets: [] },
      root: { node: { type: 'element', content: { elementType: 'container', children: [] } } },
      components: {
        'blog-posts-create': {
          node: { type: 'element', content: { elementType: 'container', children: nodes } },
        },
      },
    },
    files,
    dependencies: {},
    devDependencies: {},
    template: { files: [], subFolders: [] },
  } as unknown as ProjectPluginStructure
}

const editorSource = (structure: ProjectPluginStructure): string =>
  (structure.files.get('rich-text-editor-component')?.files[0]?.content as string) ?? ''

describe('the embed format on a generated rich-text editor', () => {
  it('adds the blot, the toolbar entry and the runtime module when a field asks for it', async () => {
    const structure = await new NextRichTextEditorProjectPlugin().runAfter(
      makeStructure(editorNode(['bold', 'link', EMBED_FORMAT]))
    )

    const source = editorSource(structure)
    expect(source).toContain(`from './${EMBED_RUNTIME_FILE_NAME}'`)
    expect(source).toContain('registerEmbedBlot')
    expect(source).toContain(
      `if (formats.includes("${EMBED_FORMAT}")) mediaGroup.push("${EMBED_FORMAT}")`
    )
    expect(source).toContain('EmbedDialog')
    expect(structure.files.get(EMBED_RUNTIME_FILE_NAME)?.files[0]?.content).toBe(
      RichTextEmbedsCodegen.generateEmbedRuntimeModuleSource()
    )
  })

  it('leaves the editor exactly as before for a project with no embed field', async () => {
    const structure = await new NextRichTextEditorProjectPlugin().runAfter(
      makeStructure(editorNode(['bold', 'link']))
    )

    expect(editorSource(structure)).toBe(generateRichTextEditorComponentCode())
    expect(structure.files.has(EMBED_RUNTIME_FILE_NAME)).toBe(false)
  })

  it('treats a field with no explicit formats as not asking for embeds', async () => {
    const structure = await new NextRichTextEditorProjectPlugin().runAfter(
      makeStructure(editorNode(null))
    )

    expect(editorSource(structure)).toBe(generateRichTextEditorComponentCode())
  })

  it('turns embeds on for the whole editor when any one field asks for them', async () => {
    const structure = await new NextRichTextEditorProjectPlugin().runAfter(
      makeStructure(editorNode(['bold']), editorNode(['bold', EMBED_FORMAT]))
    )

    expect(editorSource(structure)).toContain('registerEmbedBlot')
  })

  it('still adds the Quill dependencies and the CSS import', async () => {
    const structure = await new NextRichTextEditorProjectPlugin().runAfter(
      makeStructure(editorNode(['bold', EMBED_FORMAT]))
    )

    expect(structure.dependencies['react-quill-new']).toBe('^3.0.0')
    expect(structure.dependencies.quill).toBe('^2.0.0')
    expect(structure.files.get('_app')?.files[0]?.content).toContain(
      "import 'quill/dist/quill.snow.css';"
    )
  })

  it('emits an editor that parses in both shapes', () => {
    expect(() =>
      parse(generateRichTextEditorComponentCode(), { sourceType: 'module', plugins: ['jsx'] })
    ).not.toThrow()
    expect(() =>
      parse(generateRichTextEditorComponentCode({ withEmbeds: true }), {
        sourceType: 'module',
        plugins: ['jsx'],
      })
    ).not.toThrow()
  })

  it('imports only helpers the runtime module exports', () => {
    const source = generateRichTextEditorComponentCode({ withEmbeds: true })
    const runtime = RichTextEmbedsCodegen.generateEmbedRuntimeModuleSource()

    const block = source.match(
      new RegExp(`import \\{([^}]+)\\} from '\\./${EMBED_RUNTIME_FILE_NAME}'`)
    )
    expect(block).not.toBeNull()

    const imported = (block as RegExpMatchArray)[1]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    expect(imported.length).toBeGreaterThan(0)

    imported.forEach((name) => {
      expect(runtime).toMatch(new RegExp(`^export (?:var|function) ${name}\\b`, 'm'))
      // An import nothing calls is dead weight in every generated project.
      expect(source.split(name).length).toBeGreaterThan(2)
    })
  })

  it('normalizes the preview back out of the value before onChange sees it', () => {
    const source = generateRichTextEditorComponentCode({ withEmbeds: true })

    expect(source).toContain('normalizeEmbedsInEditorHtml(html)')
    expect(source).toContain('normalizeEmbedsForStorage(holder)')
    // The preview is a SIBLING of the block; mounting it inside the frame would
    // put it in the database.
    expect(source).toContain('block.appendChild(host)')
  })
})

/*
 * Three defects found by driving the generated admin panel in a browser. Each
 * is invisible in the emitted source unless you know what to look for, and each
 * breaks the editor in a way that looks like a different bug entirely.
 */
describe('the generated editor survives being driven', () => {
  const source = generateRichTextEditorComponentCode({ withEmbeds: true })
  const plain = generateRichTextEditorComponentCode()

  /*
   * `next/dynamic` attaches a `ref` to its OWN loadable wrapper, so a `ref` on
   * <ReactQuill> never reaches the editor: `quillRef.current.getEditor` is
   * undefined, the insert returns early and the dialog closes having done
   * nothing at all.
   */
  it('hands the ref to the editor through a prop, since next/dynamic keeps the ref', () => {
    expect(source).toContain('const QuillWithRef = (props) => {')
    expect(source).toContain('const { forwardedRef, ...editorProps } = props')
    expect(source).toContain('<Editor ref={forwardedRef} {...editorProps} />')
    expect(source).toContain('forwardedRef={attachEditor}')
    // The ref that never arrived must not be written on the dynamic component.
    expect(source).not.toMatch(/<ReactQuill\s+ref=\{/)
  })

  /*
   * react-quill rebuilds the editor whenever `modules` is not deep-equal to the
   * previous one, and its comparison holds functions to reference equality. A
   * page emits `quillFormats` as a fresh array literal every render, so a memo
   * keyed on the array rebuilt the handlers object — and Quill with it — on
   * every keystroke, taking the caret and the scroll position along.
   */
  it('keeps modules stable across renders, so typing cannot rebuild the editor', () => {
    expect(source).toContain(
      "const formatsKey = Array.isArray(formats) ? formats.join('\\u0000') : String(formats)"
    )
    expect(source).toContain('useMemo(() => buildToolbarFromFormats(formats), [formatsKey])')
    expect(source).toContain(
      'const openEmbedDialog = useCallback(() => setEmbedDialogOpen(true), [])'
    )
    expect(source).toContain('}, [toolbar, embedsEnabled, openEmbedDialog])')
    // An inline handler here is what made the object differ every render.
    expect(source).not.toMatch(/handlers: \{\s*"tq-embed": \(\) =>/)
  })

  /*
   * The STORED value has previews and activation markers stripped, so it is
   * never byte-identical to the html the editor emitted — and react-quill
   * replaces the whole document whenever the `value` prop differs from what it
   * last produced. Handing the editor its own html back is what stops that.
   */
  it('feeds the editor its own html when the form echoes the normalized value', () => {
    expect(source).toContain('const lastEmittedRef = useRef({ raw: null, stored: null })')
    expect(source).toContain('lastEmittedRef.current = { raw: html, stored: stored }')
    expect(source).toContain(
      'lastEmitted.stored !== null && incoming === lastEmitted.stored ? lastEmitted.raw : incoming'
    )
    expect(source).toContain('value={editorValue}')
  })

  it('mounts previews once the async editor exists, not only when the value changes', () => {
    expect(source).toContain('const [isEditorReady, setEditorReady] = useState(false)')
    expect(source).toContain('setEditorReady(!!instance)')
    expect(source).toContain('}, [embedsEnabled, isEditorReady, value, getEditor])')
  })

  it('leaves an editor without embeds untouched by any of it', () => {
    expect(plain).not.toContain('forwardedRef')
    expect(plain).not.toContain('formatsKey')
    expect(plain).not.toContain('lastEmittedRef')
    expect(plain).not.toContain('isEditorReady')
  })
})
