import { ProjectPluginStructure, ProjectType, ProjectUIDL } from '@teleporthq/teleport-types'
import { ProjectPlugini18nFiles } from '../src'

/**
 * `locales/<locale>.json` is loaded from EVERY page's getStaticProps. A locale
 * that `next.config.js` advertises but has no file for takes the whole build
 * down with a module-not-found, so the writer follows the language list, not
 * just the translations it happens to have.
 */

const buildStructure = (
  internationalization: ProjectUIDL['internationalization']
): ProjectPluginStructure =>
  ({
    uidl: {
      name: 'Store',
      internationalization,
      root: { styleSetDefinitions: {} },
    },
    files: new Map(),
    dependencies: {},
    devDependencies: {},
  } as unknown as ProjectPluginStructure)

const runPlugin = async (internationalization: ProjectUIDL['internationalization']) => {
  const structure = buildStructure(internationalization)
  await new ProjectPlugini18nFiles({ projectType: ProjectType.NEXT }).runAfter(structure)
  return structure.files
}

const contentOf = (files: ProjectPluginStructure['files'], locale: string) =>
  JSON.parse(files.get(locale)?.files[0]?.content ?? 'null')

describe('the messages files', () => {
  it('writes one per translated locale', async () => {
    const files = await runPlugin({
      main: { name: 'English', locale: 'en' },
      languages: { en: 'English', es: 'Spanish' },
      translations: {
        en: { greeting: { type: 'static', content: 'Hello' } },
        es: { greeting: { type: 'static', content: 'Hola' } },
      },
    } as unknown as ProjectUIDL['internationalization'])

    expect(contentOf(files, 'en')).toEqual({ greeting: 'Hello' })
    expect(contentOf(files, 'es')).toEqual({ greeting: 'Hola' })
  })

  it('writes an empty file for a language that has no translations yet', async () => {
    const files = await runPlugin({
      main: { name: 'English', locale: 'en' },
      languages: { en: 'English', fr: 'French' },
      translations: { en: { greeting: { type: 'static', content: 'Hello' } } },
    } as unknown as ProjectUIDL['internationalization'])

    expect(files.get('fr')).toBeDefined()
    expect(contentOf(files, 'fr')).toEqual({})
  })

  it('replaces the dots next-intl reads as a namespace separator', async () => {
    const files = await runPlugin({
      main: { name: 'English', locale: 'en' },
      languages: { en: 'English' },
      translations: {
        en: { '2. Definitions_UUSf6E': { type: 'static', content: 'Definitions' } },
      },
    } as unknown as ProjectUIDL['internationalization'])

    expect(contentOf(files, 'en')).toEqual({ '2_ Definitions_UUSf6E': 'Definitions' })
  })
})
