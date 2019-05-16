import {
  component,
  elementNode,
  staticNode,
} from '@teleporthq/teleport-generator-shared/lib/builders/uidl-builders'
import {
  ComponentStructure,
  ChunkDefinition,
} from '@teleporthq/teleport-generator-shared/lib/typings/generators'
import { createPlugin } from '../src/index'

describe('Testing the functionality for StyledComponents', () => {
  const plugin = createPlugin()
  const componentChunk: ChunkDefinition = {
    name: 'react-component',
    meta: {
      nodesLookup: {
        container: {
          openingElement: {
            name: {
              name: '',
            },
          },
        },
      },
    },
    type: 'js',
    linkAfter: ['import-local'],
    content: {},
  }

  it('Should not add styled as dependency', async () => {
    const uidlSample = component('StyledComponents', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      chunks: [componentChunk],
      dependencies: {},
    }

    const { dependencies } = await plugin(structure)

    expect(Object.keys(dependencies).length).toBe(0)
  })

  it('Should add styled as dependency', async () => {
    const style = {
      height: staticNode('100px'),
    }
    const element = elementNode('container', {}, [], { type: 'package' }, style)
    const elementWithKey = {
      ...element,
      content: {
        ...element.content,
        key: 'container',
      },
    }
    const uidlSample = component('StyledComponents', elementWithKey)
    const structure: ComponentStructure = {
      uidl: uidlSample,
      chunks: [componentChunk],
      dependencies: {},
    }

    const { dependencies } = await plugin(structure)
    const { styled } = dependencies

    expect(Object.keys(dependencies).length).toBeGreaterThan(0)
    expect(styled.type).toBe('library')
    expect(styled.path).toBe('styled-components')
  })

  it('Generator should not break when chunks are missing', async () => {
    const element = elementNode('container', {}, [], {})
    const elementWithKey = {
      ...element,
      content: {
        ...element.content,
        key: 'container',
      },
    }
    const uidlSample = component('StyledComponents', elementWithKey)

    const structure: ComponentStructure = {
      uidl: uidlSample,
      chunks: [],
      dependencies: {},
    }

    const { dependencies } = await plugin(structure)

    expect(Object.keys(dependencies).length).toBe(0)
  })
})
