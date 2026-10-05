import generate from '@babel/generator'
import { ChunkDefinition, ProjectUIDL } from '@teleporthq/teleport-types'
import { InlineScriptErrorGuard } from '@teleporthq/teleport-shared'
import { createDocumentFileChunks } from '../src/utils'

/**
 * A script in the project's custom code that throws used to cover every page of
 * the generated app with Next's "Unhandled Runtime Error" overlay. `_document`
 * now runs the inline script error guard before anything else in <head>, and
 * only for a project that has scripts of its own.
 */

const uidlWith = (globals: Record<string, unknown>): ProjectUIDL =>
  ({
    name: 'site',
    globals: {
      settings: { title: 'Site', language: 'en' },
      meta: [{ name: 'description', content: 'Site' }],
      assets: [{ type: 'style', path: 'https://fonts.test/font.css' }],
      ...globals,
    },
    root: { name: 'App', node: { type: 'element', content: { elementType: 'Router' } } },
  } as unknown as ProjectUIDL)

const documentSource = (uidl: ProjectUIDL): string => {
  const chunks = createDocumentFileChunks(uidl, { assets: {} } as never)
  const chunk = (chunks.js as ChunkDefinition[])[0]
  return generate(chunk.content as never).code
}

describe('generated _document — inline script error guard', () => {
  it('runs before everything else in <head> when the custom code has a script', () => {
    const source = documentSource(
      uidlWith({ customCode: { body: '<script>new Accordion().init()</script>' } })
    )
    const head = source.slice(source.indexOf('<Head>') + '<Head>'.length).trimStart()

    expect(head.startsWith('<script dangerouslySetInnerHTML={{')).toBe(true)
    expect(source).toContain(JSON.stringify(InlineScriptErrorGuard.INLINE_SCRIPT_ERROR_GUARD))
    expect(source.indexOf('stopImmediatePropagation')).toBeLessThan(
      source.indexOf('new Accordion().init()')
    )
  })

  it('runs for an inline script asset too', () => {
    const source = documentSource(
      uidlWith({ assets: [{ type: 'script', content: 'console.log(1)' }] })
    )

    expect(source).toContain('stopImmediatePropagation')
  })

  it('leaves the document of a project without scripts of its own untouched', () => {
    const source = documentSource(uidlWith({ customCode: { head: '<style>body{}</style>' } }))

    expect(source).not.toContain('stopImmediatePropagation')
  })
})
