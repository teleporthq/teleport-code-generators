import { ComponentStructure, UIDLStyleSetDefinition } from '@teleporthq/teleport-types'
import { createReactStyledComponentsPlugin } from '../src'
import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { createComponentChunk } from './mocks'

describe('Referenced Styles on Node', () => {
  const componentChunk = createComponentChunk()
  const uidl = component('MyComponent', elementNode('container', null, [], null, null, null, null))

  it('Media and pseudo styles are generated from referencedStyles', async () => {
    const plugin = createReactStyledComponentsPlugin()
    uidl.node.content.referencedStyles = {
      '5ed659b1732f9b804f7b6381': {
        type: 'style-map',
        content: {
          mapType: 'inlined',
          conditions: [{ conditionType: 'screen-size', maxWidth: 991 }],
          styles: {
            display: staticNode('none'),
          },
        },
      },
      '5ed659b1732f9b804f7b6382': {
        type: 'style-map',
        content: {
          mapType: 'inlined',
          conditions: [{ conditionType: 'element-state', content: 'hover' }],
          styles: {
            display: staticNode('block'),
          },
        },
      },
    }
    uidl.node.content.key = 'container'

    const structure: ComponentStructure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {},
    }

    const { chunks, dependencies } = await plugin(structure)
    const containerChunk = chunks.find((chunk) => chunk.name === 'Container')

    expect(containerChunk).toBeDefined()
    expect(containerChunk.content.type).toBe('VariableDeclaration')

    const declerationArguments = containerChunk.content.declarations[0].init.arguments
    expect(declerationArguments.length).toBe(1)
    expect(declerationArguments[0].name).not.toBe('projectStyleVariants')
    expect(declerationArguments[0].properties.length).toBe(2)
    expect(declerationArguments[0].properties[0].key.value).toBe('@media(max-width: 991px)')
    expect(declerationArguments[0].properties[1].key.value).toBe('&:hover')

    expect(Object.keys(dependencies).length).toBe(1)
  })

  it('References a style from project and adds, Media and pseudo from referencedStyles', async () => {
    const plugin = createReactStyledComponentsPlugin()
    uidl.node.content.referencedStyles = {
      '5ed659b1732f9b804f7b6381': {
        type: 'style-map',
        content: {
          mapType: 'inlined',
          conditions: [{ conditionType: 'screen-size', maxWidth: 991 }],
          styles: {
            display: staticNode('none'),
          },
        },
      },
      '5ed659b1732f9b804f7b6382': {
        type: 'style-map',
        content: {
          mapType: 'inlined',
          conditions: [{ conditionType: 'element-state', content: 'hover' }],
          styles: {
            display: staticNode('block'),
          },
        },
      },
      '5ed659b1732f9b804f7b6384': {
        type: 'style-map',
        content: {
          mapType: 'project-referenced',
          referenceId: 'primaryButton',
        },
      },
    }
    uidl.node.content.key = 'container'

    const structure: ComponentStructure = {
      uidl,
      chunks: [componentChunk],
      dependencies: {},
      options: {},
    }

    const styleSetDefinitions: Record<string, UIDLStyleSetDefinition> = {
      primaryButton: {
        type: 'reusable-project-style-map',
        content: {
          background: staticNode('blue'),
          color: staticNode('red'),
        },
      },
    }

    structure.options.projectStyleSet = {
      styleSetDefinitions,
      fileName: 'style',
      path: '..',
    }

    const { chunks, dependencies } = await plugin(structure)
    const containerChunk = chunks.find((chunk) => chunk.name === 'Container')

    expect(containerChunk).toBeDefined()
    expect(containerChunk.content.type).toBe('VariableDeclaration')

    const declerationArguments = containerChunk.content.declarations[0].init.arguments

    expect(declerationArguments.length).toBe(2)
    expect(declerationArguments[0].name).toBe('projectStyleVariants')
    expect(declerationArguments[1].properties.length).toBe(2)
    expect(declerationArguments[1].properties[0].key.value).toBe('@media(max-width: 991px)')
    expect(declerationArguments[1].properties[1].key.value).toBe('&:hover')

    expect(Object.keys(dependencies).length).toBe(2)
  })
})
