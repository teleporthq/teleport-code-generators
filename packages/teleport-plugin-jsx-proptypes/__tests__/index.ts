import { createPropTypesPlugin } from '../src'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import {
  ComponentStructure,
  ChunkType,
  FileType,
  ChunkDefinition,
} from '@teleporthq/teleport-types'

describe('plugin-jsx-proptypes', () => {
  const plugin = createPropTypesPlugin()
  const reactChunk: ChunkDefinition = {
    type: ChunkType.AST,
    fileType: FileType.JS,
    name: 'jsx-component',
    content: {},
    linkAfter: [],
  }
  const exportChunk = {
    type: ChunkType.AST,
    fileType: FileType.JS,
    name: 'export',
    content: {},
    linkAfter: ['jsx-component'],
  }

  it('Should throw error when the chunk is supplied', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [],
      dependencies: {},
    }
    try {
      await plugin(structure)
    } catch (e) {
      expect(e.message).toContain('JSX component chunk with name')
    }
  })

  it('Should generate chunks, defaultProps and propTypes', async () => {
    const props = {
      test: {
        type: 'boolean',
        defualtValue: 'true',
      },
      name: {
        type: 'string',
        defaultValue: 'Teleport',
      },
    }

    const uidlSample = component('SimpleComponent', elementNode('container'), props)
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [reactChunk, exportChunk],
      dependencies: {},
    }
    const result = await plugin(structure)

    const defaultProps = result.chunks.filter((chunk) => chunk.name === 'component-default-props')
    const propTypes = result.chunks.filter((chunk) => chunk.name === 'component-types-of-props')

    expect(defaultProps.length).toEqual(1)
    expect(defaultProps[0].type).toBe(ChunkType.AST)
    expect(propTypes.length).toEqual(1)
    expect(propTypes[0].type).toBe(ChunkType.AST)
  })

  it('Should not generate defaultProps', async () => {
    const props = {
      test: {
        type: 'boolean',
      },
      name: {
        type: 'string',
      },
    }

    const uidlSample = component('SimpleComponent', elementNode('container'), props)
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [reactChunk, exportChunk],
      dependencies: {},
    }
    const result = await plugin(structure)

    const defaultProps = result.chunks.filter((chunk) => chunk.name === 'component-default-props')
    const propTypes = result.chunks.filter((chunk) => chunk.name === 'component-types-of-props')

    expect(defaultProps.length).toEqual(0)
    expect(propTypes.length).toEqual(1)
    expect(propTypes[0].type).toBe(ChunkType.AST)
  })

  it('Should generate chunks after specifying required to props', async () => {
    const props = {
      test: {
        type: 'boolean',
        isRequired: true,
      },
      name: {
        type: 'string',
        isRequired: true,
      },
    }

    const uidlSample = component('SimpleComponent', elementNode('container'), props)
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [reactChunk, exportChunk],
      dependencies: {},
    }
    const result = await plugin(structure)

    const defaultProps = result.chunks.filter((chunk) => chunk.name === 'component-default-props')
    const propTypes = result.chunks.filter((chunk) => chunk.name === 'component-types-of-props')

    expect(defaultProps.length).toEqual(0)
    expect(propTypes.length).toEqual(1)
    expect(propTypes[0].type).toBe(ChunkType.AST)
  })
})
