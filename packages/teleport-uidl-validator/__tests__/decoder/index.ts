import { UIDLConditionalNode, UIDLStateDefinition } from '@teleporthq/teleport-types'
import {
  conditionalNodeDecoder,
  stateDefinitionsDecoder,
  cmsListRepeaterNodeDecoder,
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
