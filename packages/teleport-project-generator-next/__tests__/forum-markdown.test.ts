import { buildForumMarkdownSource } from '../src/forum/markdown-source'

interface ForumMarkdown {
  renderForumMarkdown: (markdown: string) => string
  forumPlainText: (markdown: string) => string
}

/** The emitted module, loaded as the generated site would require it. */
const loadModule = (storageBase?: string): ForumMarkdown => {
  const source = buildForumMarkdownSource({ storageBase })
  const module = { exports: {} as ForumMarkdown }
  // tslint:disable-next-line:function-constructor
  new Function('module', 'exports', source)(module, module.exports)
  return module.exports
}

const { renderForumMarkdown, forumPlainText } = loadModule('https://files.example.com/p1/')

describe('forum markdown renderer', () => {
  it('renders the allowed subset', () => {
    expect(renderForumMarkdown('Hello **world** and _you_ and ~~gone~~ `x<y`')).toBe(
      '<p>Hello <strong>world</strong> and <em>you</em> and <s>gone</s> <code>x&lt;y</code></p>'
    )
    expect(renderForumMarkdown('## Title\n### Sub\n\ntext\nmore')).toBe(
      '<h2>Title</h2><h3>Sub</h3><p>text<br />more</p>'
    )
    expect(renderForumMarkdown('- a\n- b\n  - c\n1. one\n2. two')).toBe(
      '<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul><ol><li>one</li><li>two</li></ol>'
    )
    expect(renderForumMarkdown('> quoted\n> line\n\n---\n\n```js\nvar a = "<b>"\n```')).toBe(
      '<blockquote><p>quoted<br />line</p></blockquote><hr /><pre><code class="language-js">var a = &quot;&lt;b&gt;&quot;</code></pre>'
    )
  })

  it('links only http(s), in a new tab, nofollow', () => {
    expect(renderForumMarkdown('see [docs](https://example.com/a?b=1&c=2)')).toBe(
      '<p>see <a href="https://example.com/a?b=1&amp;c=2" rel="nofollow ugc noopener" target="_blank">docs</a></p>'
    )
    expect(renderForumMarkdown('go https://example.com now')).toContain(
      '<a href="https://example.com" rel="nofollow ugc noopener" target="_blank">https://example.com</a>'
    )
    for (const bad of [
      '[x](javascript:alert(1))',
      '[x](javascript:alert%281%29)',
      '[x](data:text/html;base64,PHNjcmlwdD4=)',
      '[x](ftp://host/file)',
      '[x](/profile/1)',
    ]) {
      expect(renderForumMarkdown(bad)).not.toContain('<a ')
    }
  })

  it('shows images only from https or the project uploads', () => {
    expect(renderForumMarkdown('![cat](https://files.example.com/p1/cat.png)')).toBe(
      '<p><img src="https://files.example.com/p1/cat.png" alt="cat" loading="lazy" /></p>'
    )
    expect(renderForumMarkdown('![cat](http://evil.example/cat.png)')).toBe('<p>cat</p>')
    expect(renderForumMarkdown('![cat](javascript:alert%281%29)')).toBe('<p>cat</p>')
    expect(renderForumMarkdown('![cat](javascript:alert(1))')).not.toContain('<img')
    const noBase = loadModule()
    expect(noBase.renderForumMarkdown('![c](https://any.example/c.png)')).toContain('<img ')
  })

  it('never lets raw HTML, handlers or entity tricks through', () => {
    const corpus = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">x</a>',
      '[x](https://a.b" onclick="alert(1))',
      '[x](https://a.b"onmouseover="alert(1))',
      '![x](https://a.b/x.png" onerror="alert(1))',
      '&lt;script&gt;alert(1)&lt;/script&gt;',
      '[x](&#106;avascript:alert(1))',
      '[x](java\tscript:alert(1))',
      '[[x]](https://a.b)](javascript:alert(1))',
      '`<script>`',
      '```\n</code></pre><script>alert(1)</script>\n```',
      '<svg/onload=alert(1)>',
      '"><iframe src=https://evil></iframe>',
      '</p><style>body{display:none}</style>',
    ]
    for (const sample of corpus) {
      const html = renderForumMarkdown(sample)
      // No tag the renderer does not write, no handler attribute, no script URL.
      expect(html).not.toMatch(
        /<script|<iframe|<style|<svg|<[^>]*\son\w+=|(href|src)="(javascript|data):/i
      )
      // Every tag in the output is one the renderer writes itself.
      const tags = (html.match(/<\/?([a-z0-9]+)/g) || []).map((tag) => tag.replace(/<\/?/, ''))
      for (const tag of tags) {
        expect([
          'p',
          'br',
          'strong',
          'em',
          's',
          'code',
          'pre',
          'a',
          'img',
          'h2',
          'h3',
          'hr',
          'ul',
          'ol',
          'li',
          'blockquote',
        ]).toContain(tag)
      }
      // No attribute value can close its quote: the only quotes are the renderer's.
      expect(html.match(/"/g)?.length ?? 0).toBeLessThanOrEqual(
        (html.match(/ (href|src|alt|rel|target|class|loading)="/g) || []).length * 2
      )
    }
  })

  it('emphasises a handle without linking it and keeps e-mail addresses whole', () => {
    expect(renderForumMarkdown('thanks @jane_doe!')).toBe(
      '<p>thanks <em class="forum-mention">@jane_doe</em>!</p>'
    )
    expect(renderForumMarkdown('mail me at jane@example.com')).toBe(
      '<p>mail me at jane@example.com</p>'
    )
  })

  it('reads the words out for search and excerpts', () => {
    expect(
      forumPlainText('## Hi\n\n- **bold** [link](https://x.y) ![alt](https://x.y/i.png)\n\n> q `c`')
    ).toBe('Hi bold link alt q c')
    expect(forumPlainText('<b>raw</b> text')).toBe('raw text')
  })

  it('stays a short module', () => {
    expect(buildForumMarkdownSource().split('\n').length).toBeLessThanOrEqual(220)
  })
})
