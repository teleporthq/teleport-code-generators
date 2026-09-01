import {
  UIDLCMSListRepeaterNodeContent,
  UIDLConditionalNode,
  UIDLStateDefinition,
} from '@teleporthq/teleport-types'
import {
  conditionalNodeDecoder,
  stateDefinitionsDecoder,
  cmsListRepeaterNodeDecoder,
  renderingConditionsDecoder,
} from '../../src/decoders/utils'

test('decode conditional nodes properly when using dynamic and expression reference', () => {
  const node: UIDLConditionalNode = {
    type: 'conditional',
    content: {
      node: {
        type: 'element',
        content: {
          elementType: 'cms-navigation-button',
          semanticType: 'div',
          name: 'Previous',
          referencedStyles: {
            TQ_Cami9r8BH2: {
              type: 'style-map',
              content: {
                mapType: 'project-referenced',
                referenceId: 'button',
              },
            },
          },
          abilities: {
            link: {
              type: 'navlink',
              content: {
                routeName: {
                  type: 'expr',
                  content:
                    // tslint:disable no-invalid-template-strings
                    "`?${new URLSearchParams({...router.query, ['cPage-5iuksa']: parseInt(router.query['cPage-5iuksa']) - 1 || 1})}`",
                },
              },
            },
          },
          style: {
            display: {
              type: 'static',
              content: 'flex',
            },
          },
          children: [
            {
              type: 'element',
              content: {
                elementType: 'text',
                referencedStyles: {},
                abilities: {},
                children: [
                  {
                    type: 'static',
                    content: 'Previous',
                  },
                ],
              },
            },
          ],
        },
      },
      reference: {
        type: 'expr',
        content: 'params?.meta?.pagination.hasPrevPage',
      },
      value: true,
    },
  }

  const result = conditionalNodeDecoder.run(node)
  expect(result.ok).toBeTruthy()
})

// Regression guard for the admin-panel deep-link feature: state definitions
// declared with `urlSearchParamBinding` must survive `validateProjectSchema`
// — otherwise `createStateHookAST` never sees the binding and the generated
// `useState(...)` call silently falls back to the static default, leaving
// detail panels unable to auto-open from URLs like
// `/admin/products?products_detail_panel_item_id=<id>`. The json-type-validation
// `object(...)` decoder is strict and drops any unlisted key, so adding
// `urlSearchParamBinding` to the type without also adding it to the decoder
// would produce exactly this silent-stripping bug.
test('stateDefinitionsDecoder preserves urlSearchParamBinding round-trip', () => {
  const state: UIDLStateDefinition = {
    type: 'string',
    defaultValue: '',
    urlSearchParamBinding: { key: 'products_detail_panel_item_id' },
  }

  const result = stateDefinitionsDecoder.run(state)
  expect(result.ok).toBeTruthy()
  if (result.ok) {
    expect(result.result.urlSearchParamBinding).toEqual({
      key: 'products_detail_panel_item_id',
    })
  }
})

test('stateDefinitionsDecoder keeps a non-empty static default alongside a URL binding (fallback path)', () => {
  const state: UIDLStateDefinition = {
    type: 'string',
    defaultValue: 'all',
    urlSearchParamBinding: { key: 'category' },
  }

  const result = stateDefinitionsDecoder.run(state)
  expect(result.ok).toBeTruthy()
  if (result.ok) {
    expect(result.result.defaultValue).toBe('all')
    expect(result.result.urlSearchParamBinding?.key).toBe('category')
  }
})

test('stateDefinitionsDecoder rejects urlSearchParamBinding that is missing the required `key`', () => {
  const state = {
    type: 'string',
    defaultValue: '',
    urlSearchParamBinding: {},
  } as unknown as UIDLStateDefinition

  const result = stateDefinitionsDecoder.run(state)
  expect(result.ok).toBeFalsy()
})

/**
 * ⛔ THE decoder hazard, stated once and enforced for the whole node.
 *
 * `object()` silently DROPS any key absent from its schema, and the decoded UIDL
 * REPLACES the input for the rest of the pipeline — so a field the type and the
 * code generator both know about, but the decoder does not, simply ceases to
 * exist somewhere in the middle with nothing logged. It has cost three shipped
 * defects on this one node: `searchUrlParamKey` (URL search sync dead), `cache`
 * (every published list uncached) and `isLoading` (a state-backed list showed
 * "no results" for the whole fetch — its loading branch was still generated for
 * its STYLES, so the skeleton CSS was in the output and everything looked wired).
 *
 * This map is exhaustive by construction: add a field to
 * `UIDLCMSListRepeaterNodeContent` and this file stops COMPILING until you have
 * said which side it falls on, and adding it as `preserved` then fails the test
 * below until the decoder knows about it too.
 */
const REPEATER_CONTENT_FIELDS: Record<
  keyof UIDLCMSListRepeaterNodeContent,
  'preserved' | 'assigned-after-validation'
> = {
  elementType: 'preserved',
  name: 'preserved',
  attrs: 'preserved',
  dependency: 'preserved',
  nodes: 'preserved',
  renderPropIdentifier: 'preserved',
  source: 'preserved',
  paginated: 'preserved',
  perPage: 'preserved',
  searchEnabled: 'preserved',
  searchDebounce: 'preserved',
  searchDefaultValue: 'preserved',
  searchUrlParamKey: 'preserved',
  sort: 'preserved',
  isLoading: 'preserved',
  sortDirection: 'preserved',
  cache: 'preserved',
  paginationMode: 'preserved',
  infiniteScroll: 'preserved',
  infiniteScrollLoadMore: 'preserved',
  pageUrlParamKey: 'preserved',
  // Stamped by the generator AFTER validation, never carried in from the UIDL.
  key: 'assigned-after-validation',
}

test('cmsListRepeaterNodeDecoder preserves every content field the type declares', () => {
  const sample: Record<string, unknown> = {
    elementType: 'container',
    name: 'cms-list-repeater',
    attrs: { dataNodeId: { type: 'static', content: 'node-1' } },
    dependency: {
      type: 'package',
      path: '@teleporthq/react-components',
      version: 'latest',
      meta: { namedImport: true },
    },
    nodes: {
      list: { type: 'element', content: { elementType: 'container' } },
      empty: { type: 'element', content: { elementType: 'container' } },
      loading: { type: 'element', content: { elementType: 'container' } },
    },
    renderPropIdentifier: 'favouriteProduct',
    source: 'favouriteProducts',
    paginated: true,
    perPage: 20,
    searchEnabled: true,
    searchDebounce: 300,
    searchDefaultValue: { type: 'static', content: 'shoes' },
    searchUrlParamKey: 'searchKeyword',
    sort: { type: 'static', content: 'name' },
    sortDirection: { type: 'static', content: 'asc' },
    isLoading: { type: 'expr', content: "isLoadingFavourites || ''" },
    cache: { enabled: true, ttlSeconds: 300, client: true, server: true },
    paginationMode: 'numbered',
    infiniteScroll: false,
    infiniteScrollLoadMore: false,
    pageUrlParamKey: 'page',
  }

  const expected = Object.entries(REPEATER_CONTENT_FIELDS)
    .filter(([, kind]) => kind === 'preserved')
    .map(([field]) => field)

  // Every preserved field must be exercised — a field left out of `sample`
  // would pass the round trip below without ever being decoded.
  expect(Object.keys(sample).sort()).toEqual([...expected].sort())

  const result = cmsListRepeaterNodeDecoder.run({ type: 'cms-list-repeater', content: sample })
  expect(result.ok).toBeTruthy()
  if (result.ok) {
    const content = result.result.content as Record<string, unknown>
    // Compared as a SET, not field by field: a new field that the decoder drops
    // has to fail here rather than wait for someone to add an assertion for it.
    expect(Object.keys(content).sort()).toEqual([...expected].sort())
    expect(content.isLoading).toEqual({ type: 'expr', content: "isLoadingFavourites || ''" })
  }
})

test('cmsListRepeaterNodeDecoder preserves searchUrlParamKey through validation', () => {
  // Regression guard for the "searchKeyword in the URL is ignored" bug: the
  // `object()` decoder silently DROPS any key absent from its schema, so the
  // products-list search input's `searchUrlParamKey` must stay listed or its
  // two-way URL sync dies before the pagination plugin ever sees it.
  const node = {
    type: 'cms-list-repeater',
    content: {
      elementType: 'container',
      name: 'cms-list-repeater',
      renderPropIdentifier: 'ecommerceProduct',
      paginated: true,
      perPage: 20,
      searchEnabled: true,
      searchDebounce: 300,
      searchUrlParamKey: 'searchKeyword',
      nodes: {
        list: { type: 'element', content: { elementType: 'container' } },
      },
    },
  }

  const result = cmsListRepeaterNodeDecoder.run(node)
  expect(result.ok).toBeTruthy()
  if (result.ok) {
    // The validated `VCMSListRepeaterElementNode` content type narrows to
    // `{ nodes }`, so read the preserved scalar fields off the runtime shape.
    const content = result.result.content as {
      searchUrlParamKey?: string
      searchEnabled?: boolean
      searchDebounce?: number
    }
    expect(content.searchUrlParamKey).toBe('searchKeyword')
    // The sibling search fields still decode alongside it.
    expect(content.searchEnabled).toBe(true)
    expect(content.searchDebounce).toBe(300)
  }
})

test('cmsListRepeaterNodeDecoder preserves the pagination shape fields', () => {
  const node = {
    type: 'cms-list-repeater',
    content: {
      elementType: 'container',
      name: 'cms-list-repeater',
      renderPropIdentifier: 'ecommerceProduct',
      paginated: true,
      perPage: 20,
      paginationMode: 'numbered',
      pageUrlParamKey: 'page',
      nodes: {
        list: { type: 'element', content: { elementType: 'container' } },
      },
    },
  }

  const result = cmsListRepeaterNodeDecoder.run(node)
  expect(result.ok).toBeTruthy()
  if (result.ok) {
    const content = result.result.content as {
      paginationMode?: string
      pageUrlParamKey?: string
    }
    expect(content.paginationMode).toBe('numbered')
    expect(content.pageUrlParamKey).toBe('page')
  }
})

test('cmsListRepeaterNodeDecoder rejects a paginationMode outside the union', () => {
  const node = {
    type: 'cms-list-repeater',
    content: {
      elementType: 'container',
      name: 'cms-list-repeater',
      renderPropIdentifier: 'ecommerceProduct',
      paginationMode: 'carousel',
      nodes: {
        list: { type: 'element', content: { elementType: 'container' } },
      },
    },
  }

  expect(cmsListRepeaterNodeDecoder.run(node).ok).toBeFalsy()
})

test('cmsListRepeaterNodeDecoder preserves the infinite-scroll flags', () => {
  const node = {
    type: 'cms-list-repeater',
    content: {
      elementType: 'container',
      name: 'cms-list-repeater',
      renderPropIdentifier: 'ecommerceProduct',
      paginated: true,
      perPage: 20,
      infiniteScroll: true,
      infiniteScrollLoadMore: true,
      nodes: {
        list: { type: 'element', content: { elementType: 'container' } },
      },
    },
  }

  const result = cmsListRepeaterNodeDecoder.run(node)
  expect(result.ok).toBeTruthy()
  if (result.ok) {
    const content = result.result.content as {
      infiniteScroll?: boolean
      infiniteScrollLoadMore?: boolean
    }
    expect(content.infiniteScroll).toBe(true)
    expect(content.infiniteScrollLoadMore).toBe(true)
  }
})

// Same silent-stripping hazard as above, for rendering conditions: the decoded
// UIDL REPLACES the input in every generator pipeline, so a condition-entry
// field missing from the decoder never reaches codegen. `containsField` was
// stripped this way (contains-on-object-field degraded to plain contains in
// every published app); per-entry `reference` would break far louder — the
// entry would silently compare the WRONG state.
test('renderingConditionsDecoder preserves containsField and per-entry references', () => {
  const renderingConditions = {
    reference: {
      type: 'dynamic',
      content: { referenceType: 'state', id: 'newsletterOfferVisible' },
    },
    condition: {
      conditions: [
        { operation: '===', operand: true },
        {
          operation: '===',
          operand: false,
          reference: {
            type: 'dynamic',
            content: { referenceType: 'state', id: 'userIsLoggedIn' },
          },
        },
        { operation: 'contains', operand: 'tag-1', containsField: 'tags' },
      ],
      matchingCriteria: 'all',
    },
  }

  const result = renderingConditionsDecoder.run(renderingConditions)
  expect(result.ok).toBeTruthy()
  if (result.ok) {
    const decodedConditions = result.result.condition.conditions as Array<{
      operation: string
      containsField?: string
      reference?: { type: string; content: { id: string } }
    }>
    expect(decodedConditions[1].reference?.content.id).toBe('userIsLoggedIn')
    expect(decodedConditions[2].containsField).toBe('tags')
    expect(result.result.condition.matchingCriteria).toBe('all')
  }
})

test('renderingConditionsDecoder preserves nested condition groups — (a && b) || c', () => {
  const renderingConditions = {
    reference: {
      type: 'dynamic',
      content: { referenceType: 'state', id: 'a' },
    },
    condition: {
      conditions: [
        {
          conditions: [
            { operation: '===', operand: 1 },
            {
              operation: '===',
              operand: 3,
              reference: { type: 'dynamic', content: { referenceType: 'state', id: 'b' } },
            },
          ],
          matchingCriteria: 'all',
        },
        {
          operation: '===',
          operand: 5,
          reference: { type: 'dynamic', content: { referenceType: 'state', id: 'c' } },
        },
      ],
      matchingCriteria: '||',
    },
  }

  const result = renderingConditionsDecoder.run(renderingConditions)
  expect(result.ok).toBeTruthy()
  if (result.ok) {
    const decodedConditions = result.result.condition.conditions as Array<{
      operation?: string
      matchingCriteria?: string
      conditions?: Array<{
        operation: string
        operand?: unknown
        reference?: { type: string; content: { id: string } }
      }>
      reference?: { type: string; content: { id: string } }
    }>
    expect(decodedConditions[0].conditions).toHaveLength(2)
    expect(decodedConditions[0].matchingCriteria).toBe('all')
    expect(decodedConditions[0].conditions?.[1].reference?.content.id).toBe('b')
    expect(decodedConditions[1].operation).toBe('===')
    expect(decodedConditions[1].reference?.content.id).toBe('c')
    expect(result.result.condition.matchingCriteria).toBe('||')
  }
})
