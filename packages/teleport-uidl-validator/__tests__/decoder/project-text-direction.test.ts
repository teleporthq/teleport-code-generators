import { globalProjectValuesDecoder } from '../../src/decoders/project-decoder'

/**
 * ⛔ THE DECODER IS THE SCHEMA.
 *
 * `object()` drops every key it does not name, and the project generator
 * REPLACES the input UIDL with the decoded result (`cleanedUIDL = projectUIDL`).
 * A field added to the types and written by the editor but missed here reaches
 * the generator as `undefined` — with nothing logged, nothing failing, and the
 * feature simply absent from every published site.
 *
 * The writing-direction fields are exactly that shape: absent for almost every
 * project, so a silent drop would only ever be noticed by the handful of
 * merchants who need them.
 */
describe('project globals decoder — writing direction', () => {
  const decode = (settings: Record<string, unknown>) =>
    globalProjectValuesDecoder.runWithException({
      settings,
      meta: [],
      assets: [],
    }).settings as Record<string, unknown>

  it('keeps a right-to-left project direction', () => {
    expect(decode({ title: 'Shop', language: 'ar', dir: 'rtl' }).dir).toBe('rtl')
  })

  it('keeps the RTL locale list of an internationalized project', () => {
    expect(decode({ title: 'Shop', language: 'en', rtlLocales: ['ar', 'he'] }).rtlLocales).toEqual([
      'ar',
      'he',
    ])
  })

  it('leaves an ordinary project untouched', () => {
    const settings = decode({ title: 'Shop', language: 'en' })
    expect(settings).toEqual({ title: 'Shop', language: 'en' })
  })

  it('rejects a direction that is neither', () => {
    expect(() => decode({ title: 'Shop', language: 'en', dir: 'sideways' })).toThrow()
  })
})
