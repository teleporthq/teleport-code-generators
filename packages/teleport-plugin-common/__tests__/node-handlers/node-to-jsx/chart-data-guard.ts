import * as types from '@babel/types'
import generate from '@babel/generator'
import generateJSXSyntax from '../../../src/node-handlers/node-to-jsx'
import {
  JSXGenerationParams,
  JSXGenerationOptions,
} from '../../../src/node-handlers/node-to-jsx/types'
import { UIDLAttributeValue, UIDLDependency, UIDLElementNode } from '@teleporthq/teleport-types'

/**
 * A react-chartjs-2 chart whose data did not arrive draws empty: the page's
 * server render must never fail because a query was refused.
 */

const CHARTJS_DEPENDENCY: UIDLDependency = {
  type: 'package',
  path: 'react-chartjs-2',
  version: '5.2.0',
  meta: { namedImport: true },
}

const chartNode = (
  attrs: Record<string, UIDLAttributeValue>,
  dependency: UIDLDependency = CHARTJS_DEPENDENCY,
  elementType = 'Bar'
): UIDLElementNode => ({
  type: 'element',
  content: { key: 'chart', elementType, dependency, attrs, children: [] },
})

const buildParams = (): JSXGenerationParams => ({
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
  dynamicReferencePrefixMap: { prop: 'props', state: '', local: '' },
}

/** The chart element inside the bounded wrapper the generator draws around it. */
const chartOf = (result: types.JSXElement): types.JSXElement =>
  result.children.find((child): child is types.JSXElement => child.type === 'JSXElement')

const dataCode = (chart: types.JSXElement): string => {
  const attr = chart.openingElement.attributes.find(
    (candidate): candidate is types.JSXAttribute =>
      candidate.type === 'JSXAttribute' &&
      candidate.name.type === 'JSXIdentifier' &&
      candidate.name.name === 'data'
  )
  const value = attr?.value as types.JSXExpressionContainer
  return generate(value.expression as types.Expression).code.replace(/\s+/g, ' ')
}

describe('react-chartjs-2 data guard', () => {
  it('draws an empty chart when the bound data is missing', () => {
    const node = chartNode({
      data: { type: 'dynamic', content: { referenceType: 'state', id: 'salesChart' } },
    })

    const result = generateJSXSyntax(node, buildParams(), options) as types.JSXElement

    expect(dataCode(chartOf(result))).toBe(
      'Array.isArray(salesChart?.datasets) ? salesChart : { labels: [], datasets: [] }'
    )
  })

  it('leaves a data object written out in place, hoisted to a constant, as it is', () => {
    const node = chartNode({
      data: {
        type: 'static',
        content: { labels: ['Mon'], datasets: [{ label: 'Sales', data: [3] }] },
      } as unknown as UIDLAttributeValue,
    })

    const result = generateJSXSyntax(node, buildParams(), options) as types.JSXElement

    expect(dataCode(chartOf(result))).toBe('__staticProp0')
  })

  it('does not touch the data of components from other packages', () => {
    const node = chartNode(
      { data: { type: 'dynamic', content: { referenceType: 'state', id: 'rows' } } },
      { type: 'package', path: 'some-other-lib', version: '1.0.0' },
      'Bar'
    )

    const result = generateJSXSyntax(node, buildParams(), options) as types.JSXElement

    expect(dataCode(result)).toBe('rows')
  })
})
