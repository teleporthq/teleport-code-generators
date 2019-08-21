import * as types from '@babel/types'
import { createPlugin } from '../src'
import { component, elementNode } from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

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
    uidlSample.meta = {
      title: 'Test Title',
    }

    const jsChunk = {
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.JS,
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
    expect(titleProperty.value.value).toBe('Test Title')
  })

  it('Should set the meta tags in the <Helmet> component', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.meta = {
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

    const jsChunk = {
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.JS,
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
})
