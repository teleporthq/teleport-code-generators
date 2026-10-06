import { RichTextEmbeds } from '../../src'
import {
  RICH_TEXT_EMBED_CLASS,
  buildCalloutHtml,
  buildCodeBlockHtml,
  buildProtectedBlockHtml,
  mergeBlockquoteLines,
  normalizeLegacyRichTextHtml,
  rebuildQuillListHtml,
  trimEmptyEdgeParagraphs,
} from '../../src/utils/rich-text-content'

// The DOM half of the contract (`toEditorHtml`, `fromEditorHtml`, the help-center
// round trips) is covered in teleport-gui, whose test runner has a DOM — this
// repo's jest runs in a node environment. What runs here is the string-only
// half, the part a generated page runs where there is no DOM.

describe('the shared constants', () => {
  it('names the embed figure the way the embed contract does', () => {
    expect(RICH_TEXT_EMBED_CLASS).toBe(RichTextEmbeds.EMBED_CLASS_NAME)
  })
})

describe('the stored markup builders', () => {
  it('escapes code and names its language', () => {
    expect(buildCodeBlockHtml('html', '<div>\n  x\n</div>')).toBe(
      '<pre><code class="language-html">&lt;div&gt;\n  x\n&lt;/div&gt;</code></pre>'
    )
    expect(buildCodeBlockHtml('plain', 'a')).toBe('<pre><code>a</code></pre>')
    expect(buildCodeBlockHtml('c++', 'a')).toBe('<pre><code class="language-c++">a</code></pre>')
  })

  it('writes a callout and a protected wrapper in their one spelling', () => {
    expect(buildCalloutHtml('warning', '<p>Careful.</p>')).toBe(
      '<aside class="tq-callout" data-kind="warning"><p>Careful.</p></aside>'
    )
    expect(buildProtectedBlockHtml('table', '<table></table>')).toBe(
      '<div class="tq-protected" data-tq-protected="table" contenteditable="false"><table></table></div>'
    )
  })
})

describe('normalizeLegacyRichTextHtml', () => {
  it('turns what the studio form stored for a list into real lists', () => {
    const studio =
      '<ol><li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>bullet one</li>' +
      '<li data-list="bullet"><span class="ql-ui" contenteditable="false"></span>bullet two</li>' +
      '<li data-list="ordered"><span class="ql-ui" contenteditable="false"></span>number one</li>' +
      '<li data-list="ordered"><span class="ql-ui" contenteditable="false"></span>number two</li></ol>' +
      '<blockquote>quoted</blockquote><p>plain</p>'
    expect(normalizeLegacyRichTextHtml(studio)).toBe(
      '<ul><li>bullet one</li><li>bullet two</li></ul><ol><li>number one</li><li>number two</li></ol>' +
        '<blockquote><p>quoted</p></blockquote><p>plain</p>'
    )
  })

  it('rebuilds nesting from the indent classes', () => {
    const studio =
      '<ol><li data-list="ordered">Step one</li>' +
      '<li data-list="bullet" class="ql-indent-1">detail a</li>' +
      '<li data-list="bullet" class="ql-indent-1">detail b</li>' +
      '<li data-list="ordered">Step two</li></ol>'
    expect(normalizeLegacyRichTextHtml(studio)).toBe(
      '<ol><li>Step one<ul><li>detail a</li><li>detail b</li></ul></li><li>Step two</li></ol>'
    )
  })

  it('merges the quote lines the studio stored into one quote of paragraphs', () => {
    expect(
      normalizeLegacyRichTextHtml('<blockquote>one</blockquote><blockquote>two</blockquote>')
    ).toBe('<blockquote><p>one</p><p>two</p></blockquote>')
  })

  it('turns what the admin panel stored into plain spaces and a real code block', () => {
    const admin =
      '<ul><li>bullet&nbsp;one</li><li>bullet&nbsp;two</li></ul>' +
      '<p>Run&nbsp;<strong>npm&nbsp;install</strong>&nbsp;first.</p>' +
      '<pre data-language="plain">\n&lt;div&gt;\nx\n&lt;/div&gt;\n</pre>'
    expect(normalizeLegacyRichTextHtml(admin)).toBe(
      '<ul><li>bullet one</li><li>bullet two</li></ul>' +
        '<p>Run <strong>npm install</strong> first.</p>' +
        '<pre><code>&lt;div&gt;\nx\n&lt;/div&gt;</code></pre>'
    )
  })

  it('keeps a no-break space that stands next to another space', () => {
    expect(normalizeLegacyRichTextHtml('<p>a&nbsp; b</p>')).toBe('<p>a&nbsp; b</p>')
  })

  it("turns the studio's code-block lines into one pre", () => {
    const studio =
      '<div class="ql-code-block-container" spellcheck="false">' +
      '<div class="ql-code-block" data-language="javascript">const a = 1</div>' +
      '<div class="ql-code-block" data-language="javascript"><br></div>' +
      '<div class="ql-code-block" data-language="javascript">  return a</div></div><p>after</p>'
    expect(normalizeLegacyRichTextHtml(studio)).toBe(
      '<pre><code class="language-javascript">const a = 1\n\n  return a</code></pre><p>after</p>'
    )
  })

  it('leaves stored HTML as it is', () => {
    const stored =
      '<h2 id="a">A</h2><p>Text with <code>code</code>.</p>' +
      '<ol><li>a<ul><li>b</li></ul></li></ol>' +
      '<blockquote><p>x</p></blockquote><blockquote><p>y</p></blockquote>' +
      '<pre><code class="language-js">let a = 1</code></pre>' +
      '<aside class="tq-callout" data-kind="tip"><p>Tip.</p></aside>' +
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'
    expect(normalizeLegacyRichTextHtml(stored)).toBe(stored)
  })

  it('reads a deeper first line as the top level', () => {
    expect(
      rebuildQuillListHtml(
        '<li data-list="bullet" class="ql-indent-2">a</li><li data-list="bullet">b</li>'
      )
    ).toBe('<ul><li>a</li><li>b</li></ul>')
  })

  it('leaves a run of stored quotes alone', () => {
    const run = '<blockquote><p>a</p></blockquote><blockquote><p>b</p></blockquote>'
    expect(mergeBlockquoteLines(run)).toBe(run)
  })

  it('drops the empty paragraphs Quill adds at either end, and keeps one in the middle', () => {
    expect(trimEmptyEdgeParagraphs('<p><br></p><p>a</p><p><br></p><p>b</p><p><br></p>')).toBe(
      '<p>a</p><p><br></p><p>b</p>'
    )
    expect(trimEmptyEdgeParagraphs('<p></p><h2>x</h2>')).toBe('<h2>x</h2>')
  })
})
