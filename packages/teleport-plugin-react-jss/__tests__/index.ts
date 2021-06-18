import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure, ChunkType } from '@teleporthq/teleport-types'
import { createReactJSSPlugin } from '../src/index'
import { createComponentChunk } from './mocks'

describe('plugin-react-jss', () => {
  const plugin = createReactJSSPlugin({
    styleChunkName: 'jss-chunk',
  })
  const componentChunk = createComponentChunk()

  it('generates no chunk if no styles exist', async () => {
    const uidlSample = component('JSS', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(1)
  })

  it('Should add react-jss as dependency', async () => {
    const style = {
      height: staticNode('100px'),
    }
    const element = elementNode(
      'container',
      {},
      [],
      { type: 'package' as const, version: '10.4.0', path: 'react-jss' },
      style
    )
    element.content.key = 'container'
    const uidlSample = component('JSS', element)
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const { dependencies, chunks } = await plugin(structure)
    const { createUseStyles } = dependencies

    expect(Object.keys(dependencies).length).toBeGreaterThan(0)
    expect(createUseStyles.type).toBe('package')
    expect(createUseStyles.path).toBe('react-jss')

    expect(chunks.length).toBe(2)
    expect(chunks[1].type).toBe(ChunkType.AST)
    expect(chunks[1].name).toBe('jss-chunk')
  })
})
