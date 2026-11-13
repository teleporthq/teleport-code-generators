import { projectUIDLDecoder } from '../../src/decoders/project-decoder'
import projectSample from '../../../../examples/test-samples/project-sample.json'

/**
 * ⛔ THE DECODER IS THE SCHEMA: a field of `internationalization` it does not name is dropped.
 * `languageDetails` carries what a language switcher shows besides the code and the English name:
 * each language's own name, its name in every language of the project, and its flag.
 */
const decode = (internationalization: Record<string, unknown>) =>
  (
    projectUIDLDecoder.runWithException({ ...projectSample, internationalization }) as unknown as {
      internationalization: Record<string, unknown>
    }
  ).internationalization

const BASE = {
  main: { name: 'English', locale: 'en' },
  languages: { en: 'English', fr: 'French' },
  translations: {},
}

const LANGUAGE_DETAILS = {
  en: {
    nativeName: 'English',
    names: { en: 'English', fr: 'Anglais' },
    flag: 'https://play.teleporthq.io/static/flags/4x3/us.svg',
  },
  fr: {
    nativeName: 'Français',
    names: { en: 'French', fr: 'Français' },
    flag: 'https://play.teleporthq.io/static/flags/4x3/fr.svg',
  },
}

describe('project decoder — language details', () => {
  it('keeps languageDetails whole', () => {
    expect(decode({ ...BASE, languageDetails: LANGUAGE_DETAILS }).languageDetails).toEqual(
      LANGUAGE_DETAILS
    )
  })

  it('keeps a language with only some of the details', () => {
    expect(decode({ ...BASE, languageDetails: { fr: { nativeName: 'Français' } } })).toMatchObject({
      languageDetails: { fr: { nativeName: 'Français' } },
    })
  })

  it('leaves a project without them as before', () => {
    const decoded = decode(BASE)
    expect(decoded.languageDetails).toBeUndefined()
    expect(decoded.languages).toEqual(BASE.languages)
  })

  it('rejects a name that is not text', () => {
    expect(() => decode({ ...BASE, languageDetails: { fr: { nativeName: 42 } } })).toThrow()
  })
})
