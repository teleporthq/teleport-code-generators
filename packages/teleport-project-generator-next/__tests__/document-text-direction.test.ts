import generate from '@babel/generator'
import { ChunkDefinition, ProjectUIDL } from '@teleporthq/teleport-types'
import { createDocumentFileChunks } from '../src/utils'

/**
 * `dir` on `<html>`.
 *
 * Next.js sets `lang` from the route locale for an internationalized project
 * and never sets `dir` — so a right-to-left locale renders left-to-right, and
 * every logical property in the stylesheet resolves the wrong way. That makes
 * the missing attribute worse than never having written logical properties at
 * all, which is why it is tested rather than assumed.
 *
 * The other half of the contract is what happens to everybody else: a project
 * with no RTL language must come out EXACTLY as it did before, so there is a
 * test for the attribute being absent too.
 */

const uidlWith = (
  settings: Record<string, unknown>,
  internationalization?: Record<string, unknown>
): ProjectUIDL =>
  ({
    name: 'shop',
    globals: {
      settings: { title: 'Shop', language: 'en', ...settings },
      meta: [],
      assets: [],
    },
    ...(internationalization ? { internationalization } : {}),
    root: { name: 'App', node: { type: 'element', content: { elementType: 'Router' } } },
  } as unknown as ProjectUIDL)

const documentSource = (uidl: ProjectUIDL): string => {
  const chunks = createDocumentFileChunks(uidl, { assets: {} } as never)
  const chunk = (chunks.js as ChunkDefinition[])[0]
  return generate(chunk.content as never).code
}

describe('generated _document — writing direction', () => {
  it('emits nothing at all for a left-to-right project', () => {
    const source = documentSource(uidlWith({}))
    expect(source).toContain('lang="en"')
    expect(source).not.toContain('dir=')
  })

  it('emits a literal direction for a single-language RTL project', () => {
    const source = documentSource(uidlWith({ language: 'ar', dir: 'rtl' }))
    expect(source).toContain('lang="ar"')
    expect(source).toContain('dir="rtl"')
  })

  // With i18n the answer changes per request, so it has to be an expression
  // over the route locale rather than a literal.
  it('emits a per-locale expression when an internationalized project has an RTL locale', () => {
    const source = documentSource(
      uidlWith({ rtlLocales: ['ar', 'he'] }, { languages: { en: 'en', ar: 'ar' } })
    )
    // Next sets `lang` itself for an i18n project; only `dir` is ours.
    expect(source).not.toContain('lang=')
    expect(source).toContain('dir=')
    expect(source).toContain('"ar"')
    expect(source).toContain('"he"')
    expect(source).toContain('__NEXT_DATA__')
    expect(source).toContain('"rtl"')
    expect(source).toContain('"ltr"')
  })

  it('emits nothing for an internationalized project whose locales are all LTR', () => {
    const source = documentSource(uidlWith({}, { languages: { en: 'en', fr: 'fr' } }))
    expect(source).not.toContain('dir=')
  })
})
