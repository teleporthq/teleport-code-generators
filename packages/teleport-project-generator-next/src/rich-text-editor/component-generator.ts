import { RichTextEmbeds } from '@teleporthq/teleport-shared'
import { EMBED_RUNTIME_IMPORT, EMBED_SUPPORT_SOURCE } from './embed-support-source'

interface RichTextEditorOptions {
  /**
   * Emit the code-embed blot, preview and dialog. Off unless a rich-text field
   * in the project actually enables the `tq-embed` format, so an editor that
   * does not offer embeds is generated exactly as it always was.
   */
  withEmbeds?: boolean
}

/**
 * Generates the RichTextEditor wrapper component source code.
 *
 * The component uses `react-quill-new` via `next/dynamic` to avoid SSR issues
 * (Quill accesses `document`). It builds a Quill toolbar configuration from the
 * `quillFormats` prop and supports both the "snow" and "bubble" themes.
 *
 * With embeds enabled it also registers the `tq-embed` block blot, adds the
 * toolbar button that opens the embed dialog, previews sandboxed embeds beside
 * their block, and normalizes those previews back out of the value before it
 * reaches `onChange`.
 */
export const generateRichTextEditorComponentCode = (
  options: RichTextEditorOptions = {}
): string => {
  const { withEmbeds = false } = options
  const embedBlotName = RichTextEmbeds.EMBED_BLOT_NAME

  const imports = withEmbeds
    ? `import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
${EMBED_RUNTIME_IMPORT}`
    : `import { useMemo } from 'react'
import dynamic from 'next/dynamic'
`

  // The blot has to exist before Quill parses any content, so registration
  // rides the same dynamic import that loads the editor.
  const quillImport = withEmbeds
    ? `const ReactQuill = dynamic(
  async () => {
    const mod = await import('react-quill-new')
    const Editor = mod.default || mod
    registerEmbedBlot(mod.Quill || (mod.default && mod.default.Quill))
    // \`next/dynamic\` attaches a \`ref\` to its OWN loadable wrapper, so a ref
    // written here never reaches the editor and \`getEditor()\` — the only way to
    // the Quill instance — is unreachable. Inserting an embed and mounting the
    // previews both need it, so the ref is handed over as an ordinary prop.
    const QuillWithRef = (props) => {
      const { forwardedRef, ...editorProps } = props
      return <Editor ref={forwardedRef} {...editorProps} />
    }
    return QuillWithRef
  },
  {
    ssr: false,
    loading: () => <div />,
  }
)`
    : `const ReactQuill = dynamic(() => import('react-quill-new'), {
  ssr: false,
  loading: () => <div />,
})`

  const embedToolbarEntry = withEmbeds
    ? `  if (formats.includes(${JSON.stringify(embedBlotName)})) mediaGroup.push(${JSON.stringify(
        embedBlotName
      )})\n`
    : ''

  const body = withEmbeds ? richTextEditorWithEmbedsBody(embedBlotName) : richTextEditorPlainBody()

  const preamble = withEmbeds ? `${imports}\n${EMBED_SUPPORT_SOURCE}\n` : imports

  return `${preamble}
${quillImport}

function buildToolbarFromFormats(formats) {
  if (!formats) {
    return undefined
  }

  if (formats.length === 0) {
    return false
  }

  const toolbar = []

  const inlineGroup = []
  if (formats.includes('bold')) inlineGroup.push('bold')
  if (formats.includes('italic')) inlineGroup.push('italic')
  if (formats.includes('underline')) inlineGroup.push('underline')
  if (formats.includes('strike')) inlineGroup.push('strike')
  if (formats.includes('code')) inlineGroup.push('code')
  if (inlineGroup.length > 0) toolbar.push(inlineGroup)

  const headerGroup = []
  if (formats.includes('header')) {
    headerGroup.push({ header: [1, 2, 3, 4, 5, 6, false] })
  }
  if (headerGroup.length > 0) toolbar.push(headerGroup)

  const blockGroup = []
  if (formats.includes('blockquote')) blockGroup.push('blockquote')
  if (formats.includes('code-block')) blockGroup.push('code-block')
  if (blockGroup.length > 0) toolbar.push(blockGroup)

  const listGroup = []
  if (formats.includes('list')) {
    listGroup.push({ list: 'ordered' })
    listGroup.push({ list: 'bullet' })
    listGroup.push({ list: 'check' })
  }
  if (formats.includes('indent')) {
    listGroup.push({ indent: '-1' })
    listGroup.push({ indent: '+1' })
  }
  if (listGroup.length > 0) toolbar.push(listGroup)

  const styleGroup = []
  if (formats.includes('color')) styleGroup.push({ color: [] })
  if (formats.includes('background')) styleGroup.push({ background: [] })
  if (formats.includes('font')) styleGroup.push({ font: [] })
  if (formats.includes('size')) styleGroup.push({ size: ['small', false, 'large', 'huge'] })
  if (formats.includes('script')) {
    styleGroup.push({ script: 'sub' })
    styleGroup.push({ script: 'super' })
  }
  if (styleGroup.length > 0) toolbar.push(styleGroup)

  const alignGroup = []
  if (formats.includes('align')) alignGroup.push({ align: [] })
  if (formats.includes('direction')) alignGroup.push({ direction: 'rtl' })
  if (alignGroup.length > 0) toolbar.push(alignGroup)

  const mediaGroup = []
  if (formats.includes('link')) mediaGroup.push('link')
  if (formats.includes('image')) mediaGroup.push('image')
  if (formats.includes('video')) mediaGroup.push('video')
  if (formats.includes('formula')) mediaGroup.push('formula')
${embedToolbarEntry}  if (mediaGroup.length > 0) toolbar.push(mediaGroup)

  toolbar.push(['clean'])

  return toolbar
}

${body}
export default RichTextEditor
`
}

const richTextEditorPlainBody = (): string => `const RichTextEditor = (props) => {
  const {
    value,
    quillTheme = 'snow',
    quillFormats,
    onChange,
    readOnly = false,
    ...rest
  } = props

  // quillFormats: undefined/null → all formats (Quill default)
  // quillFormats: [] → no formats (plain text)
  // quillFormats: [...] → specific formats
  const formats = quillFormats !== undefined ? quillFormats : null
  const toolbar = useMemo(() => buildToolbarFromFormats(formats), [formats])

  const modules = useMemo(
    () => (toolbar !== undefined ? { toolbar } : {}),
    [toolbar]
  )

  return (
    <div {...rest}>
      <ReactQuill
        theme={quillTheme}
        value={value || ''}
        onChange={onChange}
        modules={modules}
        formats={formats}
        readOnly={readOnly}
      />
    </div>
  )
}
`

const richTextEditorWithEmbedsBody = (
  embedBlotName: string
): string => `const RichTextEditor = (props) => {
  const {
    value,
    quillTheme = 'snow',
    quillFormats,
    onChange,
    readOnly = false,
    ...rest
  } = props

  const quillRef = useRef(null)
  const [isEditorReady, setEditorReady] = useState(false)
  const [isEmbedDialogOpen, setEmbedDialogOpen] = useState(false)
  const lastEmittedRef = useRef({ raw: null, stored: null })

  // quillFormats: undefined/null → all formats (Quill default)
  // quillFormats: [] → no formats (plain text)
  // quillFormats: [...] → specific formats
  const formats = quillFormats !== undefined ? quillFormats : null
  const embedsEnabled = Array.isArray(formats) && formats.includes(${JSON.stringify(embedBlotName)})

  // react-quill DESTROYS AND REBUILDS the editor whenever \`modules\` is not
  // deep-equal to the previous one, and its comparison holds functions to
  // reference equality. A page renders \`quillFormats\` as a fresh array literal,
  // so keying the memo on the array itself rebuilt the toolbar — and with it the
  // handlers object — on every keystroke, taking the caret and the scroll
  // position with it. The key is the format NAMES, and the handler is made once.
  const formatsKey = Array.isArray(formats) ? formats.join('\\u0000') : String(formats)
  const toolbar = useMemo(() => buildToolbarFromFormats(formats), [formatsKey])
  const openEmbedDialog = useCallback(() => setEmbedDialogOpen(true), [])

  const modules = useMemo(() => {
    if (toolbar === undefined) {
      return {}
    }
    if (!embedsEnabled || !toolbar) {
      return { toolbar }
    }
    return {
      toolbar: {
        container: toolbar,
        handlers: {
          ${JSON.stringify(embedBlotName)}: openEmbedDialog,
        },
      },
    }
  }, [toolbar, embedsEnabled, openEmbedDialog])

  const attachEditor = useCallback((instance) => {
    quillRef.current = instance
    setEditorReady(!!instance)
  }, [])

  const getEditor = useCallback(() => {
    const instance = quillRef.current
    return instance && typeof instance.getEditor === 'function' ? instance.getEditor() : null
  }, [])

  // Content loaded into the editor is PARSED into blots, which never runs the
  // blot's \`create\`, so previews are mounted from here instead — once the
  // editor exists, and after every value change.
  useEffect(() => {
    if (!embedsEnabled || !isEditorReady) {
      return
    }
    const editor = getEditor()
    if (editor) {
      mountEmbedPreviews(editor.root)
    }
  }, [embedsEnabled, isEditorReady, value, getEditor])

  useEffect(() => {
    if (!embedsEnabled) {
      return undefined
    }
    const onMessage = (event) => {
      applyEmbedHeightMessage(event.data)
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [embedsEnabled])

  const handleChange = useCallback(
    (html, delta, source, editor) => {
      const stored = embedsEnabled ? normalizeEmbedsInEditorHtml(html) : html
      lastEmittedRef.current = { raw: html, stored: stored }
      if (!onChange) {
        return
      }
      onChange(stored, delta, source, editor)
    },
    [onChange, embedsEnabled]
  )

  // What is STORED has the previews and their activation markers stripped, so it
  // is never byte-identical to the html the editor emitted. react-quill compares
  // the two and replaces the whole document when they differ, which would be
  // every keystroke once a post holds an embed. When the form is handing back
  // exactly what this editor last produced, give the editor its own html back.
  const incoming = value || ''
  const lastEmitted = lastEmittedRef.current
  const editorValue =
    lastEmitted.stored !== null && incoming === lastEmitted.stored ? lastEmitted.raw : incoming

  const insertEmbed = useCallback((embedValue) => {
    setEmbedDialogOpen(false)
    const editor = getEditor()
    if (!editor) {
      return
    }
    const index = embedInsertIndex(editor)
    editor.insertEmbed(index, ${JSON.stringify(embedBlotName)}, embedValue, 'user')
    try {
      editor.setSelection(index + 1, 0, 'silent')
    } catch (err) {
      // An edge index can reject a selection; the embed is placed either way.
    }
    mountEmbedPreviews(editor.root)
  }, [getEditor])

  return (
    <div {...rest}>
      <ReactQuill
        forwardedRef={attachEditor}
        theme={quillTheme}
        value={editorValue}
        onChange={handleChange}
        modules={modules}
        formats={formats}
        readOnly={readOnly}
      />
      {isEmbedDialogOpen ? (
        <EmbedDialog onCancel={() => setEmbedDialogOpen(false)} onInsert={insertEmbed} />
      ) : null}
    </div>
  )
}
`
