import { staticNode, component, elementNode } from '@teleporthq/teleport-uidl-builders'
import {
  ChunkDefinition,
  FileType,
  ComponentStructure,
  UIDLReferencedStyles,
} from '@teleporthq/teleport-types'
import { setUpHASTChunk, setUpJSXComponentChunk, styleSetDefinitions } from './mocks'
import { createCSSPlugin } from '../src'

describe('Referenced Styles for inlined and project-referenced with Templates (HAST) Nodes', () => {
  const plugin = createCSSPlugin({ templateChunkName: 'template' })
  const componentChunk: ChunkDefinition = setUpHASTChunk()

  it('Generates media query from referenced styles even styles are not defined on node', async () => {
    const referencedStyles = {
      '5ed659b1732f9b804f7b6381': {
        type: 'style-map' as const,
        content: {
          mapType: 'inlined' as const,
          conditions: [{ conditionType: 'screen-size', maxWidth: 991 }],
          styles: {
            display: staticNode('none'),
          },
        },
      },
    }

    const element = elementNode('container', {}, [], null, null, null, referencedStyles)
    element.content.key = 'container'
    const uidlSample = component('test', element)

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const result = await plugin(structure)
    const { chunks } = result
    const htmlFile = chunks.find((chunk) => chunk.fileType === FileType.HTML)
    const cssFile = chunks.find((chunk) => chunk.fileType === FileType.CSS)
    const nodeReference = componentChunk.meta.nodesLookup.container

    expect(htmlFile).toBeDefined()
    expect(cssFile).toBeDefined()
    expect(cssFile.content).toContain('@media(max-width: 991px)')
    expect(nodeReference.properties.class).toBe('container')
  })

  it('Referes a style from proejct style sheet and add the inlined style too', async () => {
    const referencedStyles: UIDLReferencedStyles = {
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
      '5ed669aae53af30300760743': {
        type: 'style-map',
        content: {
          mapType: 'project-referenced',
          referenceId: 'primaryButton',
        },
      },
    }
    const style = {
      width: staticNode('100px'),
    }

    const element = elementNode('container', {}, [], null, style, null, referencedStyles)
    element.content.key = 'container'
    const uidlSample = component('test', element)

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {
        projectStyleSet: {
          styleSetDefinitions,
          fileName: 'style',
          path: '..',
        },
      },
      chunks: [componentChunk],
      dependencies: {},
    }

    const result = await plugin(structure)
    const { chunks } = result
    const htmlFile = chunks.find((chunk) => chunk.fileType === FileType.HTML)
    const cssFile = chunks.find((chunk) => chunk.fileType === FileType.CSS)
    const nodeReference = componentChunk.meta.nodesLookup.container

    expect(htmlFile).toBeDefined()
    expect(cssFile).toBeDefined()
    expect(cssFile.content).toContain('width')
    expect(cssFile.content).toContain('@media(max-width: 991px)')
    expect(nodeReference.properties.class).toBe('container primaryButton')
  })
})

// JSX based component syntax

describe('Referenced Styles for inlined and project-referenced with JSX bases Nodes', () => {
  const plugin = createCSSPlugin({
    templateStyle: 'jsx',
    declareDependency: 'decorator',
    templateChunkName: 'jsx-component',
    componentDecoratorChunkName: 'component-decorator',
  })
  const componentChunk: ChunkDefinition = setUpJSXComponentChunk()

  it('Generates media query from referenced styles even styles are not defined on node', async () => {
    const referencedStyles: UIDLReferencedStyles = {
      '5ed659b1732f9b804f7b6381': {
        type: 'style-map' as const,
        content: {
          mapType: 'inlined',
          conditions: [{ conditionType: 'screen-size', maxWidth: 991 }],
          styles: {
            display: staticNode('none'),
          },
        },
      },
    }

    const element = elementNode('container', {}, [], null, null, null, referencedStyles)
    element.content.key = 'container'
    const uidlSample = component('test', element)

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {},
      chunks: [componentChunk],
      dependencies: {},
    }

    const result = await plugin(structure)
    const { chunks } = result

    const cssFile = chunks.find((chunk) => chunk.fileType === FileType.CSS)

    expect(cssFile).toBeDefined()
    expect(cssFile.content).toContain('@media(max-width: 991px)')
  })

  it('Referes a style from proejct style sheet and add the inlined style too', async () => {
    const referencedStyles: UIDLReferencedStyles = {
      '5ed659b1732f9b804f7b6381': {
        type: 'style-map' as const,
        content: {
          mapType: 'inlined',
          conditions: [{ conditionType: 'screen-size', maxWidth: 991 }],
          styles: {
            display: staticNode('none'),
          },
        },
      },
      '5ed669aae53af30300760743': {
        type: 'style-map' as const,
        content: {
          mapType: 'project-referenced',
          referenceId: 'primaryButton',
        },
      },
    }
    const style = {
      width: staticNode('100px'),
    }

    const element = elementNode('container', {}, [], null, style, null, referencedStyles)
    element.content.key = 'container'
    const uidlSample = component('test', element)

    const structure: ComponentStructure = {
      uidl: uidlSample,
      options: {
        projectStyleSet: {
          styleSetDefinitions,
          fileName: 'style',
          path: '..',
        },
      },
      chunks: [componentChunk],
      dependencies: {},
    }

    const result = await plugin(structure)
    const { chunks } = result
    const cssFile = chunks.find((chunk) => chunk.fileType === FileType.CSS)

    expect(cssFile).toBeDefined()
    expect(cssFile.content).toContain('width')
    expect(cssFile.content).toContain('@media(max-width: 991px)')
  })
})
