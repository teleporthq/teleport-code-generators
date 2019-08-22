import * as types from '@babel/types'
import { createPlugin } from '../src'
import { component, elementNode } from '@teleporthq/teleport-shared/dist/cjs/builders/uidl-builders'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

describe('plugin-jsx-head-config', () => {
  const plugin = createPlugin()
  const jsxChunk = {
    type: CHUNK_TYPE.AST,
    fileType: FILE_TYPE.JS,
    name: 'jsx-component',
    content: {},
    linkAfter: [],
    meta: {
      nodesLookup: {
        container: {
          type: 'JSXElement',
          openingElement: {
            type: 'JSXOpeningElement',
            name: { type: 'JSXIdentifier', name: 'div' },
            attributes: [],
            selfClosing: false,
          },
          closingElement: {
            type: 'JSXClosingElement',
            name: { type: 'JSXIdentifier', name: 'div' },
          },
          children: [],
        },
      },
    },
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

  it('Should set the title in the <Helmet> component', async () => {
    const uidlSample = component('SimpleComponent', elementNode('container'))
    uidlSample.node.content.key = 'container'
    uidlSample.meta = {
      title: 'Test Title',
    }

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [jsxChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = structure.chunks[0].meta.nodesLookup.container as types.JSXElement
    expect(astNode.children.length).toBe(1)

    const helmetNode = astNode.children[0] as types.JSXElement
    expect((helmetNode.openingElement.name as types.JSXIdentifier).name).toBe('Helmet')

    const titleNode = helmetNode.children[0] as types.JSXElement
    const titleText = titleNode.children[0] as types.JSXText
    expect((titleNode.openingElement.name as types.JSXIdentifier).name).toBe('title')
    expect(titleText.value).toBe('Test Title')
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

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [jsxChunk],
      dependencies: {},
    }

    await plugin(structure)

    const astNode = structure.chunks[0].meta.nodesLookup.container as types.JSXElement
    expect(astNode.children.length).toBe(2)

    const helmetNode = astNode.children[0] as types.JSXElement
    expect((helmetNode.openingElement.name as types.JSXIdentifier).name).toBe('Helmet')

    const firstMetaNode = helmetNode.children[0] as types.JSXElement
    const secondMetaNode = helmetNode.children[1] as types.JSXElement

    const nameAttribute = firstMetaNode.openingElement.attributes[0] as types.JSXAttribute
    const valueAttribute = firstMetaNode.openingElement.attributes[1] as types.JSXAttribute
    expect((nameAttribute.name as types.JSXIdentifier).name).toBe('name')
    expect((nameAttribute.value as types.StringLiteral).value).toBe('description')
    expect((valueAttribute.name as types.JSXIdentifier).name).toBe('value')
    expect((valueAttribute.value as types.StringLiteral).value).toBe('test')

    const randomKeyAttribute = secondMetaNode.openingElement.attributes[0] as types.JSXAttribute
    expect((randomKeyAttribute.name as types.JSXIdentifier).name).toBe('randomKey')
    expect((randomKeyAttribute.value as types.StringLiteral).value).toBe('randomValue')
  })
})
