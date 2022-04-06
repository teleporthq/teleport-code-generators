import { ComponentStructure, UIDLStyleSetDefinition } from '@teleporthq/teleport-types'
import { createReactJSSPlugin } from '../src'
import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { createComponentChunk } from './mocks'

describe('Referenced Styles on Node', () => {
  const componentChunk = createComponentChunk()
  const uidl = component('MyComponent', elementNode('container', null, [], null, null, null, null))

  it('Media and pseudo styles are generated from referencedStyles', async () => {
    const plugin = createReactJSSPlugin()
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
    const result = await plugin(structure)
    const { chunks, dependencies } = result

    expect(chunks.length).toBe(2)
    expect(Object.keys(dependencies).length).toBe(1)
    expect(dependencies.createUseStyles.path).toBe('react-jss')
  })

  it('References a style from project and adds, Media and pseudo from referencedStyles', async () => {
    const plugin = createReactJSSPlugin()
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
        type: 'reusable-project-style-map' as const,
        content: {
          background: staticNode('blue'),
          color: staticNode('red'),
        },
      },
    }

    structure.options.projectStyleSet = {
      styleSetDefinitions,
      fileName: 'style',
      path: '../',
    }

    const result = await plugin(structure)
    const { chunks, dependencies } = result

    expect(chunks.length).toBe(2)
    expect(Object.keys(dependencies).length).toBe(2)
    expect(dependencies.createUseStyles.path).toBe('react-jss')
    expect(dependencies.useProjectStyles.path).toBe('../style')
    expect(dependencies.useProjectStyles.meta.namedImport).toBe(true)
  })
})
