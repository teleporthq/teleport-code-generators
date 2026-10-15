import {
  pageSeedsStateFromDataSource,
  stateQueryHasTemplatePlaceholder,
} from '../../src/utils/route-utils'

const DS_ID = 'ds-1'
const dataSources = { [DS_ID]: { id: DS_ID, type: 'teleport', config: {} } }

const state = (overrides: Record<string, unknown> = {}) => ({
  type: 'array',
  defaultValue: [] as unknown[],
  dataSourceBinding: { dataSourceId: DS_ID, refPath: ['customers'] },
  ...overrides,
})

describe('stateQueryHasTemplatePlaceholder', () => {
  it('finds a placeholder anywhere in the query', () => {
    expect(
      stateQueryHasTemplatePlaceholder(
        state({ query: "SELECT * FROM t WHERE user_id = '{{Current User.id}}'" })
      )
    ).toBe(true)
    expect(stateQueryHasTemplatePlaceholder(state({ query: 'SELECT {{ a.b }}' }))).toBe(true)
  })

  it('is false for a plain query, an empty one and no query at all', () => {
    expect(stateQueryHasTemplatePlaceholder(state({ query: 'SELECT COUNT(*) FROM t' }))).toBe(false)
    expect(stateQueryHasTemplatePlaceholder(state({ query: '' }))).toBe(false)
    expect(stateQueryHasTemplatePlaceholder(state())).toBe(false)
  })
})

describe('pageSeedsStateFromDataSource', () => {
  it('is true for a state bound to a table or to a placeholder-free raw query', () => {
    expect(pageSeedsStateFromDataSource({ stateDefinitions: { rows: state() } }, dataSources)).toBe(
      true
    )
    expect(
      pageSeedsStateFromDataSource(
        { stateDefinitions: { total: state({ query: 'SELECT COUNT(*) AS value FROM t' }) } },
        dataSources
      )
    ).toBe(true)
  })

  it('is false for a query only the browser can resolve', () => {
    expect(
      pageSeedsStateFromDataSource(
        {
          stateDefinitions: {
            rows: state({ query: "SELECT * FROM t WHERE user_id = '{{Current User.id}}'" }),
          },
        },
        dataSources
      )
    ).toBe(false)
  })

  it('is false without a binding, without states or without the bound data source', () => {
    expect(
      pageSeedsStateFromDataSource(
        { stateDefinitions: { search: { type: 'string', defaultValue: '' } } },
        dataSources
      )
    ).toBe(false)
    expect(pageSeedsStateFromDataSource({}, dataSources)).toBe(false)
    expect(pageSeedsStateFromDataSource({ stateDefinitions: { rows: state() } }, {})).toBe(false)
    expect(pageSeedsStateFromDataSource({ stateDefinitions: { rows: state() } })).toBe(false)
  })
})
