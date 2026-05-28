/**
 * Generates the RichTextEditor wrapper component source code.
 *
 * The component uses `react-quill-new` via `next/dynamic` to avoid SSR issues
 * (Quill accesses `document`). It builds a Quill toolbar configuration from the
 * `quillFormats` prop and supports both the "snow" and "bubble" themes.
 */
export const generateRichTextEditorComponentCode = (): string => {
  return `import { useMemo } from 'react'
import dynamic from 'next/dynamic'

const ReactQuill = dynamic(() => import('react-quill-new'), {
  ssr: false,
  loading: () => <div />,
})

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
  if (mediaGroup.length > 0) toolbar.push(mediaGroup)

  toolbar.push(['clean'])

  return toolbar
}

const RichTextEditor = (props) => {
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

export default RichTextEditor
`
}
