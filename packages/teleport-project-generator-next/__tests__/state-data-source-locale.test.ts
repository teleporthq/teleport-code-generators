import generator from '@babel/generator'
import * as types from '@babel/types'
import { createStateDataSourcePlugin } from '../src/state-data-source-plugin'

/**
 * A page state bound to a translated table (`teleport_products`) holds the rows
 * in the page's language: its build-time fetch says which locale it is for,
 * the same way a list's does. A raw query runs verbatim and never reaches the
 * row transform, so it carries no locale — and a single-language project
 * carries none anywhere.
 */

const DS_ID = '595ce5d7-d36c-4767-95e1-610e9c9831d6'
const FETCHER_FILE = 'teleport-teleport_products-595ce5d7'

const I18N = {
  main: { name: 'English', locale: 'en' },
  languages: { en: 'English', es: 'Spanish' },
}

const makeState = (query?: string) => ({
  type: 'array',
  defaultValue: [] as unknown[],
  dataSourceBinding: { dataSourceId: DS_ID, refPath: ['teleport_products'] },
  ...(query ? { query } : {}),
})

const makeStructure = (stateDefinitions: Record<string, unknown>, localized: boolean) => ({
  uidl: {
    name: 'Homepage',
    stateDefinitions,
    node: { type: 'element', content: { elementType: 'container' } },
    outputOptions: { folderPath: [] as string[] },
  },
  chunks: [] as any[],
  dependencies: {} as Record<string, unknown>,
  options: {
    dataSources: { [DS_ID]: { id: DS_ID, type: 'teleport', config: {} } },
    extractedResources: {
      [`utils/${FETCHER_FILE}`]: {
        fileName: FETCHER_FILE,
        fileType: 'js',
        path: ['utils', 'data-sources'],
        content: '// stub',
      },
    },
    ...(localized ? { internationalization: I18N } : {}),
  },
})

const getStaticPropsCode = async (
  stateDefinitions: Record<string, unknown>,
  localized: boolean
): Promise<string> => {
  const result = await createStateDataSourcePlugin()(
    makeStructure(stateDefinitions, localized) as any
  )
  const chunk = result.chunks.find((c: any) => c.name === 'getStaticProps')
  expect(chunk).toBeDefined()
  return generator(chunk.content as types.Node).code.replace(/\s+/g, ' ')
}

describe('state-data-source-plugin — the fetch locale', () => {
  it('fetches a bound table in the language getStaticProps runs for', async () => {
    const code = await getStaticPropsCode({ featuredProducts: makeState() }, true)
    expect(code).toContain('.fetchData({ locale: context.locale })')
  })

  it('never sends a locale with a raw query', async () => {
    const code = await getStaticPropsCode(
      { bestSellers: makeState('SELECT * FROM teleport_products ORDER BY sold DESC LIMIT 4') },
      true
    )
    expect(code).toContain('rawQuery:')
    expect(code).not.toContain('locale')
  })

  it('sends none in a single-language project', async () => {
    const code = await getStaticPropsCode({ featuredProducts: makeState() }, false)
    expect(code).toContain('.fetchData({})')
    expect(code).not.toContain('locale')
  })
})
