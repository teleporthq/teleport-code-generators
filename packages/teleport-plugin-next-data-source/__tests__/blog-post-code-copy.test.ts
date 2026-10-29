import { generateBlogPostTransformationCode } from '../src/transformations/blog-post'
import { generateSharedTransformationCode } from '../src/transformations/shared-utils'
import { CODE_COPY_BUTTON_CLASS } from '../src/transformations/code-copy'

/**
 * Every code block of a post's content opens with a Copy button on the
 * published page, written into the server-rendered HTML: the first paint has
 * it, and the site's code-copy runtime acts on the click. The button is the
 * block's first child with nothing around it — inside a `pre`, a line break
 * is a line of the code — and a block that has one is left alone.
 */

type Build = (record: unknown, options?: Record<string, unknown>) => Record<string, unknown>

const build: Build = new Function(
  generateSharedTransformationCode() +
    '\n' +
    generateBlogPostTransformationCode() +
    '\nreturn buildBlogPost;'
)() as Build

const BUTTON = `<button type="button" class="${CODE_COPY_BUTTON_CLASS}" data-copy-label="Copy" data-copied-label="Copied">Copy</button>`

const contentOf = (content: string) =>
  build({ id: 'p1', title: 'Setup', slug: 'setup', status: 'published', content }).content

describe('code blocks of a post get a Copy button', () => {
  it('opens every code block with the button, as its first child, nothing around it', () => {
    const content =
      '<p>Run it:</p><pre><code class="language-bash">npm install\nnpm run dev</code></pre>' +
      '<pre class="wide"><code class="language-json">{ "a": 1 }</code></pre>'

    expect(contentOf(content)).toBe(
      `<p>Run it:</p><pre>${BUTTON}<code class="language-bash">npm install\nnpm run dev</code></pre>` +
        `<pre class="wide">${BUTTON}<code class="language-json">{ "a": 1 }</code></pre>`
    )
  })

  it('leaves a block that has its button alone (a second render adds nothing)', () => {
    const once = contentOf('<pre><code>a</code></pre>')
    expect(contentOf(once as string)).toBe(once)
    expect((once as string).match(/<button/g)).toHaveLength(1)
  })

  it('touches nothing in a post without code', () => {
    expect(contentOf('<p>No code <code>here</code></p>')).toBe('<p>No code <code>here</code></p>')
  })

  it('does not count the button label as a word of the post', () => {
    const post = build({
      id: 'p1',
      title: 'Setup',
      slug: 'setup',
      status: 'published',
      content: '<p>one two three</p><pre><code>four</code></pre>',
    })
    expect(post.wordCount).toBe(4)
  })
})
