import { parse } from '@babel/parser'
import { generateRichTextEditorComponentCode } from '../src/rich-text-editor/component-generator'

/*
  Quill's built-in image button inlines the picked file as a base64 dataURL. That
  value then travels through the workflow runtime, which replaces any context
  entry over its prune budget (100 KB) with `{ __truncated: true }` before
  POSTing it to a server segment — so an admin who added a photo to a rich-text
  field saved the truncation placeholder into the column and lost what was
  stored there. The generated editor uploads the file and stores its URL.
*/
describe('rich text editor — image upload handler', () => {
  it.each([
    ['without embeds', {}],
    ['with embeds', { withEmbeds: true }],
  ])('rewrites the image toolbar button to upload (%s)', (_label, options) => {
    const source = generateRichTextEditorComponentCode(options)

    expect(source).toContain("fetch('/api/runtime-storage/upload'")
    expect(source).toContain('handlers')
    expect(source).toContain('image: richTextImageHandler')
    // A plain function, never an arrow: Quill calls a toolbar handler with
    // `this` bound to the toolbar module, which is the only way to the editor.
    expect(source).toContain('function richTextImageHandler() {')
    expect(source).toContain('const quill = this && this.quill')
  })

  it('falls back to embedding the file when the upload fails', () => {
    const source = generateRichTextEditorComponentCode()

    expect(source).toContain('readFileAsDataURL')
    expect(source).toContain('image upload failed, embedding the file instead')
  })

  it('hands the handler to Quill without breaking the toolbar contract', () => {
    const source = generateRichTextEditorComponentCode()

    // `false` disables the toolbar entirely (a field with no formats) — wrapping
    // it in a container object would silently switch the toolbar back on.
    expect(source).toContain('if (!toolbar) {\n      return { toolbar }\n    }')
    expect(source).toContain('container: toolbar')
  })

  it('keeps both editor variants parseable', () => {
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
})
