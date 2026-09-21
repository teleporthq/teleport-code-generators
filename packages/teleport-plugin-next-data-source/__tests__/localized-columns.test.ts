import { parse } from '@babel/parser'
import {
  collectLocalizedColumns,
  generateLocalizedColumnsHelper,
  type LocalizedColumnMap,
} from '../src/localized-columns'
import { resolveContentLocalization, isLocalizedProject } from '../src/content-localization'
import { buildProductTransformOptions, getTransformWrapperCode } from '../src/transformations'
import { generateTeleportFetcher } from '../src/fetchers/teleport'

/**
 * A Spanish listing links to `es_slug` and sorts by `es_name`, so the SQL a
 * fetch runs has to know about the per-language columns — otherwise the
 * details page 404s on the very slug the card linked to. The helper is pinned
 * here by RUNNING the emitted JavaScript, the same way the runtime does.
 */

const LOCALIZATION = { mainLocale: 'en', secondaryLocales: ['es', 'fr'] }

const PRODUCT_COLUMNS = [
  'id',
  'name',
  'slug',
  'description',
  'price',
  'og_title',
  'es_name',
  'es_slug',
  'es_description',
  'fr_name',
]

interface Helper {
  localizedEqualityClause: (
    field: string,
    operand: string,
    value: unknown,
    pushParam: (param: unknown) => string
  ) => string | null
  localizedSortFieldSql: (field: string, locale: unknown) => string | null
}

const loadHelper = (families: LocalizedColumnMap): Helper => {
  // tslint:disable-next-line:function-constructor
  const factory = new Function(
    `${generateLocalizedColumnsHelper(
      families
    )}\nreturn { localizedEqualityClause, localizedSortFieldSql }`
  )
  return factory()
}

const bindParams = () => {
  const params: unknown[] = []
  const pushParam = (param: unknown) => {
    params.push(param)
    return '$' + params.length
  }
  return { params, pushParam }
}

describe('resolveContentLocalization', () => {
  it('splits the project languages into the main locale and the copies', () => {
    expect(
      resolveContentLocalization({
        internationalization: {
          main: { name: 'English', locale: 'en' },
          languages: { en: 'English', es: 'Spanish', fr: 'French' },
        },
      })
    ).toEqual({ mainLocale: 'en', secondaryLocales: ['es', 'fr'] })
  })

  it('is absent for a single-language project', () => {
    expect(resolveContentLocalization({})).toBeUndefined()
    expect(isLocalizedProject({})).toBe(false)
  })

  it('reaches the fetcher through the shared transform options', () => {
    const options = buildProductTransformOptions({
      internationalization: {
        main: { name: 'English', locale: 'en' },
        languages: { en: 'English', es: 'Spanish' },
      },
    })
    expect(options.localization).toEqual({ mainLocale: 'en', secondaryLocales: ['es'] })
    expect(buildProductTransformOptions({}).localization).toBeUndefined()
  })
})

describe('collectLocalizedColumns', () => {
  it('pairs a column with the copies the schema actually holds', () => {
    expect(collectLocalizedColumns(PRODUCT_COLUMNS, LOCALIZATION)).toEqual({
      name: { es: 'es_name', fr: 'fr_name' },
      slug: { es: 'es_slug' },
      description: { es: 'es_description' },
    })
  })

  it('never mistakes a prefix for a language', () => {
    // `og_title` is Open Graph, and `og` is not a project language.
    const families = collectLocalizedColumns(['title', 'og_title'], LOCALIZATION)
    expect(families).toEqual({})
  })

  it('has nothing to say for a single-language project', () => {
    expect(collectLocalizedColumns(PRODUCT_COLUMNS, undefined)).toEqual({})
    expect(
      collectLocalizedColumns(PRODUCT_COLUMNS, { mainLocale: 'en', secondaryLocales: [] })
    ).toEqual({})
  })

  it('refuses a column it could not quote', () => {
    const families = collectLocalizedColumns(['slug', 'es_slug', 'pt-BR_slug'], {
      mainLocale: 'en',
      secondaryLocales: ['es', 'pt-BR'],
    })
    expect(families).toEqual({ slug: { es: 'es_slug' } })
  })
})

describe('generateLocalizedColumnsHelper', () => {
  const families = collectLocalizedColumns(PRODUCT_COLUMNS, LOCALIZATION)
  const helper = loadHelper(families)

  it('emits plain source the fetcher template can embed', () => {
    const source = generateLocalizedColumnsHelper(families)
    expect(source).not.toContain('`')
    expect(source).not.toContain('${')
    expect(() => parse(source, { sourceType: 'script' })).not.toThrow()
  })

  it('matches equality on a translatable column in every language, binding once', () => {
    const { params, pushParam } = bindParams()
    const clause = helper.localizedEqualityClause('slug', '=', 'bolso-tote', pushParam)
    expect(clause).toBe('("slug" = $1 OR "es_slug" = $1)')
    expect(params).toEqual(['bolso-tote'])
  })

  it('answers an `in` set (already normalised to an array) the same way', () => {
    const { params, pushParam } = bindParams()
    const clause = helper.localizedEqualityClause('name', '=', ['A', 'B'], pushParam)
    expect(clause).toBe(
      '("name"::text = ANY($1::text[]) OR "es_name"::text = ANY($1::text[]) OR "fr_name"::text = ANY($1::text[]))'
    )
    expect(params).toEqual([['A', 'B']])
  })

  it('leaves every other column and operand to the ordinary branches', () => {
    const { params, pushParam } = bindParams()
    expect(helper.localizedEqualityClause('price', '=', '10', pushParam)).toBeNull()
    expect(helper.localizedEqualityClause('slug', '!=', 'x', pushParam)).toBeNull()
    expect(helper.localizedEqualityClause('slug', '=', null, pushParam)).toBeNull()
    // An empty set means "no filter", as it does in the ordinary array branch.
    expect(helper.localizedEqualityClause('slug', '=', [], pushParam)).toBeNull()
    expect(params).toEqual([])
  })

  it("orders by the request's language, falling back to the base column", () => {
    expect(helper.localizedSortFieldSql('name', 'es')).toBe(
      `COALESCE(NULLIF("es_name", ''), "name")`
    )
    // The main language and a language without a copy order by the column itself.
    expect(helper.localizedSortFieldSql('name', 'en')).toBeNull()
    expect(helper.localizedSortFieldSql('slug', 'fr')).toBeNull()
    expect(helper.localizedSortFieldSql('price', 'es')).toBeNull()
    expect(helper.localizedSortFieldSql('name', null)).toBeNull()
  })

  it('is inert without families', () => {
    const inert = loadHelper({})
    const { pushParam } = bindParams()
    expect(inert.localizedEqualityClause('slug', '=', 'x', pushParam)).toBeNull()
    expect(inert.localizedSortFieldSql('name', 'es')).toBeNull()
  })
})

describe('teleport fetcher — localized columns', () => {
  const config = {
    selectedTables: {
      teleport_products: { columns: PRODUCT_COLUMNS.map((name) => ({ name })) },
    },
  }

  it('bakes the column map from the table schema and the project languages', () => {
    const route = generateTeleportFetcher(config, 'teleport_products', {
      localization: LOCALIZATION,
    })
    expect(route).toContain(
      'var LOCALIZED_COLUMNS = {"name":{"es":"es_name","fr":"fr_name"},"slug":{"es":"es_slug"},"description":{"es":"es_description"}}'
    )
    expect(route).toContain('const localizedClause = localizedEqualityClause(field, operand, value')
    expect(route).toContain(
      "const requestLocale = typeof req.query.locale === 'string' ? req.query.locale : null"
    )
    expect(route).toContain(
      'localizedSortFieldSql(sort.field, requestLocale) || sortFieldSql(sort.field)'
    )
    expect(route).toContain('localizedSortFieldSql(sortBy, requestLocale) || sortBy')
  })

  it('bakes an empty map for a single-language project', () => {
    const route = generateTeleportFetcher(config, 'teleport_products')
    expect(route).toContain('var LOCALIZED_COLUMNS = {}')
  })

  it('resolves the row transform against the request locale and the baked main locale', () => {
    const wrapper = getTransformWrapperCode('teleport_products', { localization: LOCALIZATION })
    expect(wrapper).toContain(
      "var currentLanguage = reqQuery && typeof reqQuery.locale === 'string' && reqQuery.locale ? reqQuery.locale : null"
    )
    expect(wrapper).toContain('mainLanguage: "en"')
    expect(wrapper).not.toContain('reqQuery.lang')

    expect(getTransformWrapperCode('teleport_products')).toContain('mainLanguage: null')
  })
})
