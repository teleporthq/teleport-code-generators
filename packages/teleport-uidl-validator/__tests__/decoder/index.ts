import { UIDLConditionalNode, UIDLStateDefinition } from '@teleporthq/teleport-types'
import { conditionalNodeDecoder, stateDefinitionsDecoder } from '../../src/decoders/utils'

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
