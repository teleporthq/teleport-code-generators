import * as types from '@babel/types'
import generator from '@babel/generator'
import { elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { UIDLNode } from '@teleporthq/teleport-types'
import generateJSXSyntax from '../../../src/node-handlers/node-to-jsx'
import {
  JSXGenerationParams,
  JSXGenerationOptions,
} from '../../../src/node-handlers/node-to-jsx/types'

/**
 * A repeater over the `ecommerce` global carries no array path — the editor's
 * mapper keeps only the global's id — so the generator picks the array from the
 * repeater's render-prop identifier. These pin that table: each e-commerce list
 * the editor builds must land on the context array it was bound to, and an
 * identifier the table does not know still means the cart's items.
 */

const params = (): JSXGenerationParams => ({
  dependencies: {},
  propDefinitions: {},
  stateDefinitions: {},
  globalStateDefinitions: {},
  nodesLookup: {},
  windowImports: {},
  localeReferences: [],
  localeAttributeReferences: [],
  globalReferences: [],
  globalStateReferences: [],
  hoistedConstants: [],
})

const options: JSXGenerationOptions = {
  dynamicReferencePrefixMap: {
    prop: 'props',
    state: '',
    local: '',
  },
}

const generate = (renderPropIdentifier: string): string => {
  const repeater = {
    type: 'cms-list-repeater',
    content: {
      elementType: 'Repeater',
      name: 'repeater',
      key: 'repeater',
      renderPropIdentifier,
      source: 'ecommerce',
      nodes: {
        list: elementNode('container', {}, [staticNode('row')]),
      },
    },
  } as unknown as UIDLNode
  const tree = elementNode('container', {}, [repeater])
  return generator(generateJSXSyntax(tree, params(), options) as types.JSXElement).code
}

describe('cms-list-repeater over the ecommerce global', () => {
  it('lists the shipping methods a checkout binds, not the cart items', () => {
    expect(generate('shippingMethod')).toContain('items={ecommerce?.Cart?.shippingOptions || []}')
  })

  it('keeps the payment-provider and store-location lists on their arrays', () => {
    expect(generate('paymentProvider')).toContain('items={ecommerce?.paymentProviders || []}')
    expect(generate('storeLocation')).toContain('items={ecommerce?.storeLocations || []}')
  })

  it('reads an identifier it does not know as the cart items', () => {
    expect(generate('orderItem')).toContain('items={ecommerce?.Cart?.items || []}')
  })
})
