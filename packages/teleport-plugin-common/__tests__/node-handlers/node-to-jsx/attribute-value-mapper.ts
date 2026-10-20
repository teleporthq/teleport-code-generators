import generator from '@babel/generator'
import * as types from '@babel/types'
import generateJSXSyntax from '../../../src/node-handlers/node-to-jsx'
import {
  JSXGenerationParams,
  JSXGenerationOptions,
} from '../../../src/node-handlers/node-to-jsx/types'
import { UIDLElementNode } from '@teleporthq/teleport-types'

/**
 * An attribute bound through a value mapper renders through it, as a text
 * binding does: a filter chip's `aria-pressed` reads the filter's state as
 * "true" or "false", never as the filter's value.
 */

const MAPPER = [
  'function mapValue(value) {',
  "  return String(value) === 'On track' ? 'true' : 'false';",
  '}',
].join('\n')

const chip = (valueMapper?: string): UIDLElementNode => ({
  type: 'element',
  content: {
    key: 'chip',
    elementType: 'button',
    attrs: {
      'aria-pressed': {
        type: 'dynamic',
        content: {
          referenceType: 'state',
          id: 'jobFilterStatus',
          refPath: [],
          ...(valueMapper ? { valueMapper } : {}),
        },
      },
    },
    children: [],
  },
})

const params = (): JSXGenerationParams => ({
  dependencies: {},
  propDefinitions: {},
  stateDefinitions: {
    jobFilterStatus: { type: 'string', defaultValue: '' },
  },
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

const render = (node: UIDLElementNode): string =>
  generator(generateJSXSyntax(node, params(), options) as types.Node).code.replace(/\s+/g, ' ')

describe('a dynamic attribute with a value mapper', () => {
  it('renders the mapped value', () => {
    const code = render(chip(MAPPER))
    expect(code).toContain('aria-pressed={')
    expect(code).toContain('mapValue(value)')
    expect(code).toContain('jobFilterStatus')
    expect(code).not.toContain('aria-pressed={jobFilterStatus}')
  })

  it('keeps a bare reference without one', () => {
    expect(render(chip())).toContain('aria-pressed={jobFilterStatus}')
  })
})
