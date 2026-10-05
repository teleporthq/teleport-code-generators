import { resolve } from 'path'
import { BODY_CODE_UNPACK_SCRIPT, wrapBodyCustomCode } from '../src/body-code/body-code-component'

/**
 * The unpacker run against a DOM: what it does to each kind of script in the
 * project's body custom code. This repo's own jsdom 16 cannot load (see
 * teleport-project-generator-html/__tests__/state-runtime/runtime.ts), so the
 * editor checkout next to this one lends its jsdom.
 *
 * What a DOM cannot show is why an inline script names the document: Chromium
 * reports no file for an error thrown by a script inserted after the page was
 * parsed, and _document's inline script error guard knows the project's own
 * scripts by the document's address. Measured over http with the built
 * packages: without the name such an error reaches the app's own error
 * listener in Chromium, with it the guard stops it (WebKit names the document
 * either way).
 */
const loadJSDOM = () => {
  const candidates = ['jsdom', resolve(__dirname, '../../../../teleport-gui/node_modules/jsdom')]
  for (const candidate of candidates) {
    try {
      // tslint:disable-next-line no-var-requires
      return require(candidate).JSDOM
    } catch (error) {
      // the next candidate
    }
  }
  return undefined
}
const JSDOM = loadJSDOM()
if (!JSDOM) {
  // tslint:disable-next-line no-console
  console.warn('body code unpack tests skipped: no jsdom loads (see the note in this file)')
}
const describeInDom = JSDOM ? describe : describe.skip

const PAGE = 'https://site.test/pricing'
const NAMED_AFTER_THE_PAGE = `\n//# sourceURL=${PAGE}`

const STRUCTURED_DATA = '{"@context":"https://schema.org","@type":"Organization","name":"Holm"}'

const BODY_CODE = [
  '<script src="https://cdn.site.test/widget.js"></script>',
  '<script>window.__order = (window.__order || []).concat("helper")</script>',
  '<script type="module">window.__moduleWasWritten = true</script>',
  `<script type="application/ld+json">${STRUCTURED_DATA}</script>`,
  '<script type="text/template"><p>{{ name }}</p></script>',
  '<script type="text/javascript">window.__order = window.__order.concat("widget setup")</script>',
  '<div id="widget-root"></div>',
].join('\n')

/** The page a visitor is on, with the body custom code shipped inert, then unpacked as TqBodyCode does. */
const unpackOn = (address: string) => {
  const dom = new JSDOM(
    `<!doctype html><html><body><main>Page</main>${wrapBodyCustomCode(BODY_CODE)}</body></html>`,
    { url: address, runScripts: 'dangerously' }
  )
  dom.window.eval(BODY_CODE_UNPACK_SCRIPT)
  const scripts = Array.from(dom.window.document.querySelectorAll('script')) as HTMLScriptElement[]
  return { window: dom.window, scripts }
}

describeInDom('body custom code, unpacked after hydration', () => {
  it('runs the inline scripts in the order they were written', () => {
    const { window } = unpackOn(PAGE)

    expect(window.__order).toEqual(['helper', 'widget setup'])
    expect(window.document.querySelector('template')).toBeNull()
    expect(window.document.querySelector('#widget-root')).not.toBeNull()
  })

  it('names the document as the source of every inline script that runs', () => {
    const { scripts } = unpackOn(PAGE)
    const [, helper, moduleScript, , , setup] = scripts

    expect(helper.textContent).toBe(
      `window.__order = (window.__order || []).concat("helper")${NAMED_AFTER_THE_PAGE}`
    )
    expect(moduleScript.textContent).toBe(`window.__moduleWasWritten = true${NAMED_AFTER_THE_PAGE}`)
    expect(setup.textContent).toBe(
      `window.__order = window.__order.concat("widget setup")${NAMED_AFTER_THE_PAGE}`
    )
  })

  it('names the page without the part after #, as an error names it', () => {
    const { scripts } = unpackOn(`${PAGE}#plans`)

    expect(scripts[1].textContent?.endsWith(NAMED_AFTER_THE_PAGE)).toBe(true)
  })

  it('leaves an external script and the data blocks exactly as written', () => {
    const { scripts } = unpackOn(PAGE)
    const [external, , , structuredData, markupTemplate] = scripts

    expect(external.getAttribute('src')).toBe('https://cdn.site.test/widget.js')
    expect(external.textContent).toBe('')
    expect(structuredData.textContent).toBe(STRUCTURED_DATA)
    expect(JSON.parse(structuredData.textContent || '')).toMatchObject({ name: 'Holm' })
    expect(markupTemplate.textContent).toBe('<p>{{ name }}</p>')
  })
})
