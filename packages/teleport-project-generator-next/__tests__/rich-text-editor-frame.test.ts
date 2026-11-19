import { generateRichTextEditorComponentCode } from '../src/rich-text-editor/component-generator'

/*
  A page gives the editor a box (`min-height: 220px` on the New topic page of
  the forum, 200px on an admin form) and the editor stayed one line tall inside
  it: Quill sizes its writing area to its content. The editor's own global
  styles stretch the writing area over the box it was given.
*/
describe('rich text editor — the writing area fills its box', () => {
  it.each([
    ['without embeds', {}],
    ['with embeds', { withEmbeds: true }],
  ])('ships the frame styles in the global style tag (%s)', (_label, options) => {
    const source = generateRichTextEditorComponentCode(options)
    const styles = /const RICH_TEXT_CONTENT_STYLES = ("(?:[^"\\]|\\.)*")/.exec(source)
    expect(styles).not.toBeNull()
    const css = JSON.parse((styles as RegExpExecArray)[1]) as string

    // The box's own minimum travels to Quill's root, whose two parts then share it.
    expect(css).toContain('.quill { display: flex; flex-direction: column; min-height: inherit; }')
    expect(css).toContain('.quill > .ql-container { display: flex; flex: 1 1 auto;')
    expect(css).toContain('.quill > .ql-container > .ql-editor { flex: 1 1 auto; }')
    expect(source).toContain('<style jsx global>{RICH_TEXT_CONTENT_STYLES}</style>')
  })
})
