import * as types from '@babel/types'
import generator from '@babel/generator'
import { UIDLDataSourceItemNode } from '@teleporthq/teleport-types'
import { extractDataSourceIntoGetStaticProps } from '../src/utils'
import {
  createComponentChunk,
  createDataSourceNode,
  createJavaScriptDataSource,
  createMockJSXElementWithResourceDef,
} from './mocks'

/**
 * Every provider bound to one table carries the SAME resource id
 * (`TQ_<source><table>`) — the editor derives it from the source and the table
 * only — and its own params. A list showing 10 rows and a text bound to the
 * same source therefore asked for one prefetch, and the second provider
 * rendered the first one's rows (`initialData` skips its own first fetch).
 */

const DS_ID = 'ds-js'
const RESOURCE_ID = 'TQ_dsjsdata'

const nodeWithParams = (params: Record<string, unknown>): UIDLDataSourceItemNode => {
  const node = createDataSourceNode(DS_ID, 'data', 'javascript')
  ;(node.content as { resource: unknown }).resource = { id: RESOURCE_ID, params }
  return node
}

const providerWithLimit = (limit?: number): types.JSXElement => {
  const element = createMockJSXElementWithResourceDef(DS_ID, 'data', 'javascript')
  if (limit !== undefined) {
    element.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('params'),
        types.jsxExpressionContainer(
          types.objectExpression([
            types.objectProperty(types.stringLiteral('limit'), types.numericLiteral(limit)),
          ])
        )
      )
    )
  }
  return element
}

const initialDataOf = (element: types.JSXElement): string => {
  const attr = element.openingElement.attributes.find(
    (attribute) => (attribute as types.JSXAttribute).name?.name === 'initialData'
  ) as types.JSXAttribute | undefined
  return attr ? generator(attr.value as types.Node).code : ''
}

const prefetch = (
  providers: Array<{ node: UIDLDataSourceItemNode }>,
  elements: types.JSXElement[]
) => {
  const componentChunk = createComponentChunk()
  componentChunk.content = types.jsxFragment(
    types.jsxOpeningFragment(),
    types.jsxClosingFragment(),
    elements
  )
  let getStaticPropsChunk = null
  for (const { node } of providers) {
    const result = extractDataSourceIntoGetStaticProps(
      node,
      { [DS_ID]: createJavaScriptDataSource(DS_ID) },
      componentChunk,
      getStaticPropsChunk,
      [],
      {},
      {}
    )
    getStaticPropsChunk = result.chunk
  }
  return generator(getStaticPropsChunk.content as types.Node).code.replace(/\s+/g, ' ')
}

describe('getStaticProps prefetch of providers sharing one resource', () => {
  it('gives providers with different params their own prefetch', () => {
    const limitedList = providerWithLimit(10)
    const text = providerWithLimit()

    const code = prefetch(
      [
        { node: nodeWithParams({ limit: { type: 'static', content: 10 } }) },
        { node: nodeWithParams({}) },
      ],
      [limitedList, text]
    )

    expect(initialDataOf(limitedList)).toBe('{props.data_dsjsdata}')
    expect(initialDataOf(text)).toBe('{props.data_dsjsdata_2}')
    expect(code).toContain('fetchData({ "limit": 10 })')
    expect(code).toContain('fetchData({})')
  })

  it('keeps ONE prefetch for providers with the same params', () => {
    const first = providerWithLimit()
    const second = providerWithLimit()

    const code = prefetch(
      [{ node: nodeWithParams({}) }, { node: nodeWithParams({}) }],
      [first, second]
    )

    expect(initialDataOf(first)).toBe('{props.data_dsjsdata}')
    expect(initialDataOf(second)).toBe('{props.data_dsjsdata}')
    expect(code.match(/fetchData\(/g)).toHaveLength(1)
  })
})
