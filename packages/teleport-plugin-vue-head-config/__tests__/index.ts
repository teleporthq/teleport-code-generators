import * as types from '@babel/types'
import { createPlugin } from '../src'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import {
  ComponentStructure,
  ChunkType,
  FileType,
  ChunkDefinition,
} from '@teleporthq/teleport-types'

describe('plugin-vue-head-config', () => {
  const plugin = createPlugin()

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
      expect(e.message).toContain('JS component chunk with name')
    }
  })

  it('Should set the title in head object of the component', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      title: 'Test Title',
    }

    const jsChunk: ChunkDefinition = {
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: 'vue-js-chunk',
      content: {
        declaration: {
          properties: [],
        },
      },
      linkAfter: [],
    }

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [jsChunk],
      dependencies: {},
    }

    await plugin(structure)

    const headProperty = jsChunk.content.declaration.properties[0] as types.ObjectProperty
    expect((headProperty.key as types.Identifier).name).toBe('head')

    const headObject = headProperty.value as types.ObjectExpression
    const titleProperty = headObject.properties[0] as types.ObjectProperty

    expect(titleProperty.key.value).toBe('title')
    expect((titleProperty.value as types.StringLiteral).value).toBe('Test Title')
  })

  it('Sets the meta tags in the component object', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      metaTags: [
        {
          name: 'description',
          value: 'test',
        },
        {
          randomKey: 'randomValue',
        },
      ],
    }

    const jsChunk: ChunkDefinition = {
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: 'vue-js-chunk',
      content: {
        declaration: {
          properties: [],
        },
      },
      linkAfter: [],
    }

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [jsChunk],
      dependencies: {},
    }

    await plugin(structure)

    const headProperty = jsChunk.content.declaration.properties[0] as types.ObjectProperty
    expect((headProperty.key as types.Identifier).name).toBe('head')

    const headObject = headProperty.value as types.ObjectExpression
    const metaProperty = headObject.properties[0] as types.ObjectProperty

    expect(metaProperty.key.value).toBe('meta')
  })

  it('Sets the link tag for the canonical in the component object', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.seo = {
      assets: [
        {
          type: 'canonical',
          path: 'https://teleporthq.io',
        },
      ],
    }

    const jsChunk: ChunkDefinition = {
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: 'vue-js-chunk',
      content: {
        declaration: {
          properties: [],
        },
      },
      linkAfter: [],
    }

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [jsChunk],
      dependencies: {},
    }

    await plugin(structure)

    const headProperty = jsChunk.content.declaration.properties[0] as types.ObjectProperty
    expect((headProperty.key as types.Identifier).name).toBe('head')

    const headObject = headProperty.value as types.ObjectExpression
    const linkProperty = headObject.properties[0] as types.ObjectProperty

    expect(linkProperty.key.value).toBe('link')
  })
})
