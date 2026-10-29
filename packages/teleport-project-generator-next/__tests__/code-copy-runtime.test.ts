import { resolve } from 'path'
import { ProjectPluginStructure, ProjectUIDL } from '@teleporthq/teleport-types'
import {
  buildCodeCopyHeadSnippet,
  NextCodeCopyProjectPlugin,
} from '../src/blog/code-copy-project-plugin'
import {
  CODE_COPY_BUTTON_CLASS,
  CODE_COPY_RUNTIME_SOURCE,
} from '../src/blog/code-copy-runtime-source'

/**
 * A content site's code blocks carry a Copy button (written by the post
 * transform); this is the one script that acts on it: the block's code lands
 * on the clipboard without the button's own label, and the button reads
 * "Copied" for a moment. A project without a Blog or a Help Center ships no
 * script at all.
 */

// This repo's own jsdom cannot load (see popup-runtime.test.ts); the editor
// checkout next to this one lends its jsdom.
const loadJSDOM = () => {
  const candidates = ['jsdom', resolve(__dirname, '../../../../teleport-gui/node_modules/jsdom')]
  for (const candidate of candidates) {
    try {
      // tslint:disable-next-line no-var-requires
      return require(candidate)
    } catch (error) {
      // the next candidate
    }
  }
  return undefined
}
const jsdom = loadJSDOM()

const uidlWith = (settings: Partial<ProjectUIDL>): ProjectUIDL =>
  ({
    name: 'site',
    globals: { settings: {}, customCode: { head: '<meta name="owner">' } },
    ...settings,
  } as unknown as ProjectUIDL)

describe('the code-copy script ships with a content site', () => {
  it('goes first in the head of a project with a Blog or a Help Center, and nowhere else', async () => {
    const plugin = new NextCodeCopyProjectPlugin()
    const blog = await plugin.runBefore({
      uidl: uidlWith({ blogSettings: {} as never }),
    } as ProjectPluginStructure)
    expect(blog.uidl.globals.customCode?.head).toBe(
      `<script>${CODE_COPY_RUNTIME_SOURCE}</script><meta name="owner">`
    )

    expect(buildCodeCopyHeadSnippet(uidlWith({ helpCenterSettings: {} as never }))).toContain(
      CODE_COPY_BUTTON_CLASS
    )

    const plain = await plugin.runBefore({ uidl: uidlWith({}) } as ProjectPluginStructure)
    expect(plain.uidl.globals.customCode?.head).toBe('<meta name="owner">')
  })

  const itInBrowser = jsdom ? it : it.skip
  itInBrowser('copies the block without the button label and says Copied for a moment', async () => {
    const dom = new jsdom.JSDOM(
      `<!doctype html><html><head><script>${CODE_COPY_RUNTIME_SOURCE}</script></head><body>` +
        `<pre><button type="button" class="${CODE_COPY_BUTTON_CLASS}" data-copy-label="Copy" data-copied-label="Copied">Copy</button>` +
        `<code>npm install\nnpm run dev\n</code></pre></body></html>`,
      { runScripts: 'dangerously' }
    )
    const { window } = dom
    const written: string[] = []
    Object.defineProperty(window.navigator, 'clipboard', {
      value: {
        writeText: (text: string) => {
          written.push(text)
          return Promise.resolve()
        },
      },
    })

    const button = window.document.querySelector(`.${CODE_COPY_BUTTON_CLASS}`) as HTMLButtonElement
    button.click()
    await new Promise((done) => setTimeout(done, 0))

    expect(written).toEqual(['npm install\nnpm run dev'])
    expect(button.getAttribute('data-copied')).toBe('true')
    expect(button.textContent).toBe('Copied')
    expect(window.document.querySelector('pre')!.textContent).toBe('Copiednpm install\nnpm run dev\n')
  })
})
