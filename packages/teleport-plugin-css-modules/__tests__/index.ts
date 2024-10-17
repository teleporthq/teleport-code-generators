import * as types from '@babel/types'
import { component, elementNode, dynamicNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { ComponentStructure, FileType } from '@teleporthq/teleport-types'
import { createCSSModulesPlugin } from '../src/index'
import { createComponentChunk, setupPluginStructure } from './mocks'

describe('plugin-css-modules', () => {
  it('generates no chunk if no styles exist', async () => {
    const plugin = createCSSModulesPlugin()
    const uidlSample = component('CSSModules', elementNode('container'))
    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [createComponentChunk()],
      dependencies: {},
    }

    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(1)
  })

  it('generates a string chunk out of the styles and adds the className', async () => {
    const plugin = createCSSModulesPlugin()
    const structure = setupPluginStructure()
    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(2)
    expect(chunks[1].type).toBe('string')
    expect(chunks[1].fileType).toBe(FileType.CSS)
    expect(chunks[1].content).toContain('height: 100px;')

    const nodeReference = chunks[0].meta.nodesLookup.container
    expect(nodeReference.openingElement.attributes.length).toBe(1)

    const classNameAttr = nodeReference.openingElement.attributes[0]
    expect(classNameAttr.name.name).toBe('className')
    expect(classNameAttr.value.expression.object.name).toBe('styles')
    expect(classNameAttr.value.expression.property.name).toBe(`'container'`)
  })

  it('generates a string chunk out of the styles and adds the className between brackets', async () => {
    const plugin = createCSSModulesPlugin()
    const structure = setupPluginStructure('list-container')
    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(2)
    expect(chunks[1].type).toBe('string')
    expect(chunks[1].fileType).toBe(FileType.CSS)
    expect(chunks[1].content).toContain('height: 100px;')

    const nodeReference = chunks[0].meta.nodesLookup['list-container']
    expect(nodeReference.openingElement.attributes.length).toBe(1)

    const classNameAttr = nodeReference.openingElement.attributes[0]
    expect(classNameAttr.name.name).toBe('className')
    expect(classNameAttr.value.expression.object.name).toBe('styles')
    expect(classNameAttr.value.expression.property.name).toBe(`'list-container'`)
  })

  it('generates a string chunk out of the styles and adds the class attribute', async () => {
    const plugin = createCSSModulesPlugin({ classAttributeName: 'class' })
    const structure = setupPluginStructure('list-container')
    const { chunks } = await plugin(structure)

    expect(chunks.length).toBe(2)
    expect(chunks[1].type).toBe('string')
    expect(chunks[1].fileType).toBe(FileType.CSS)
    expect(chunks[1].content).toContain('height: 100px;')

    const nodeReference = chunks[0].meta.nodesLookup['list-container']
    expect(nodeReference.openingElement.attributes.length).toBe(1)

    const classNameAttr = nodeReference.openingElement.attributes[0]
    expect(classNameAttr.name.name).toBe('class')

    expect(classNameAttr.value.expression.object.name).toBe('styles')
    expect(classNameAttr.value.expression.property.name).toBe("'list-container'")
  })

  it('generates a string chunk of type CSS', async () => {
    const plugin = createCSSModulesPlugin({ moduleExtension: true })
    const structure = setupPluginStructure('list-container')
    const { chunks, dependencies } = await plugin(structure)

    expect(chunks.length).toBe(2)
    expect(chunks[1].type).toBe('string')
    expect(chunks[1].fileType).toBe(FileType.CSS)
    expect(chunks[1].content).toContain('height: 100px;')
    expect(structure.uidl.outputOptions?.styleFileName).toContain('.module')
    expect(dependencies.styles.path).toContain('.module.css')
  })

  it('inlines dynamic style and does not generate a new chunk if no static styles are present', async () => {
    const plugin = createCSSModulesPlugin()
    const structure = setupPluginStructure('container', {
      height: dynamicNode('prop', 'height'),
    })

    const { chunks } = await plugin(structure)
    expect(chunks.length).toBe(1)

    const nodeReference = chunks[0].meta.nodesLookup.container
    expect(nodeReference.openingElement.attributes.length).toBe(1)

    const styleAttr = nodeReference.openingElement.attributes[0]
    expect(styleAttr.name.name).toBe('style')

    const dynamicStyleObject = styleAttr.value.expression as types.ObjectExpression
    const heightProperty = dynamicStyleObject.properties[0] as types.ObjectProperty
    expect(heightProperty.key.value).toBe('height')
    expect((heightProperty.value as types.MemberExpression).object.name).toBe('props.')
    expect((heightProperty.value as types.MemberExpression).property.name).toBe('height')
  })

  it('inlines dynamic style and generates a new chunk with the static styles', async () => {
    const plugin = createCSSModulesPlugin()
    const structure = setupPluginStructure('container', {
      height: dynamicNode('prop', 'height'),
      width: staticNode('auto'),
    })

    const { chunks } = await plugin(structure)
    expect(chunks.length).toBe(2)

    expect(chunks[1].type).toBe('string')
    expect(chunks[1].fileType).toBe(FileType.CSS)
    expect(chunks[1].content).toContain('width: auto;')

    const nodeReference = chunks[0].meta.nodesLookup.container
    expect(nodeReference.openingElement.attributes.length).toBe(2)

    const classNameAttr = nodeReference.openingElement.attributes[1]
    expect(classNameAttr.name.name).toBe('className')

    expect(classNameAttr.value.expression.object.name).toBe('styles')
    expect(classNameAttr.value.expression.property.name).toBe(`'container'`)

    const styleAttr = nodeReference.openingElement.attributes[0]
    expect(styleAttr.name.name).toBe('style')

    const dynamicStyleObject = styleAttr.value.expression as types.ObjectExpression
    const heightProperty = dynamicStyleObject.properties[0] as types.ObjectProperty
    expect(heightProperty.key.value).toBe('height')
    expect((heightProperty.value as types.MemberExpression).object.name).toBe('props.')
    expect((heightProperty.value as types.MemberExpression).property.name).toBe('height')
  })

  it('will not generate any media styles if the referencedStyles are empty', async () => {
    const plugin = createCSSModulesPlugin()
    const structure = setupPluginStructure()

    // structure.uidl.node.content.referencedStyles
    const { chunks } = await plugin(structure)
    const cssFile = chunks.find((chunk) => chunk.fileType === 'css')

    expect(cssFile.content).not.toContain('@media')
    expect(cssFile.content).not.toContain('hover')
  })

  it('will generate hover styles with the new referencedStyles syntax', async () => {
    const plugin = createCSSModulesPlugin()
    const structure = setupPluginStructure()

    structure.uidl.node.content.referencedStyles = {
      '5ecfb3b6f2be3a6e09ff4ad3': {
        type: 'style-map',
        content: {
          mapType: 'inlined',
          conditions: [{ conditionType: 'element-state', content: 'hover' }],
          styles: {
            height: staticNode('200px'),
          },
        },
      },
      '5ecfb3b6f2be3a6e09ff4ad4': {
        type: 'style-map',
        content: {
          mapType: 'inlined',
          conditions: [{ conditionType: 'screen-size', maxWidth: 991 }],
          styles: {
            height: staticNode('200px'),
          },
        },
      },
    }

    const result = await plugin(structure)
    const cssFile = result.chunks.find((chunks) => chunks.fileType === 'css')

    expect(cssFile).toBeDefined()
    expect(cssFile.content).toContain('.container:hover')
    expect(cssFile.content).toContain('@media(max-width: 991px)')
  })

  it('adds projectStyles when a node refers from the project style sheet', async () => {
    const plugin = createCSSModulesPlugin()
    const structure = setupPluginStructure()

    structure.options.projectStyleSet = {
      styleSetDefinitions: {
        primaryButton: {
          type: 'reusable-project-style-map',
          content: {
            background: {
              type: 'static',
              content: 'blue',
            },
          },
        },
      },
      fileName: 'style',
      path: '..',
    }

    structure.uidl.node.content.referencedStyles = {
      '5ecfb3b6f2be3a6e09ff4ad3': {
        type: 'style-map',
        content: {
          mapType: 'project-referenced',
          referenceId: 'primaryButton',
        },
      },
    }

    const result = await plugin(structure)
    const jsxChunk = result.chunks.find((chunk) => chunk.fileType === 'js')
    const cssFile = result.chunks.find((file) => file.fileType === 'css')

    const nodeReference = jsxChunk?.meta?.nodesLookup?.container
    const styleAttr = nodeReference?.openingElement?.attributes?.[0]

    expect(cssFile).toBeDefined()
    expect(jsxChunk).toBeDefined()
    expect(nodeReference?.openingElement?.attributes?.length).toBe(1)
    expect(styleAttr.value.expression.quasis.length).toBe(3)
    expect(styleAttr.value.expression.expressions.length).toBe(2)
  })
})
