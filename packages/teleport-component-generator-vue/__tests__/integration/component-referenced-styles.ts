import { createVueComponentGenerator } from '../../src'
import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import {
  UIDLReferencedStyles,
  GeneratedFile,
  FileType,
  GeneratorOptions,
} from '@teleporthq/teleport-types'

const findFileByType = (files: GeneratedFile[], type: string = FileType.JS) =>
  files.find((file) => file.fileType === type)

describe('Generates media, pseudo and normal styles', () => {
  const referencedStyles: UIDLReferencedStyles = {
    '1234567890': {
      type: 'style-map',
      content: {
        mapType: 'inlined',
        conditions: [{ conditionType: 'screen-size', maxWidth: 991 }],
        styles: {
          display: staticNode('none'),
        },
      },
    },
  }

  const style = {
    width: staticNode('100px'),
  }
  const uidl = component(
    'MyComponent',
    elementNode('container', {}, [staticNode('Hello !!')], undefined, style, null, referencedStyles)
  )

  it('Generates styles using CSS', async () => {
    const generator = createVueComponentGenerator()
    const { files } = await generator.generateComponent(uidl)
    const vueFile = findFileByType(files, FileType.VUE)

    expect(vueFile).toBeDefined()
    expect(vueFile?.content).toContain(`class="my-component-container"`)
    expect(vueFile?.content).toContain('width: 100px')
    expect(vueFile?.content).toContain('@media(max-width: 991px)')
    expect(vueFile?.content).toContain(`display: none`)
  })
})

describe('Add referenced styles even when direct styles are not present on node', () => {
  const referencedStyles: UIDLReferencedStyles = {
    '1234567890': {
      type: 'style-map',
      content: {
        mapType: 'inlined',
        conditions: [{ conditionType: 'screen-size', maxWidth: 991 }],
        styles: {
          display: staticNode('none'),
        },
      },
    },
  }

  const uidl = component(
    'MyComponent',
    elementNode(
      'container',
      {},
      [staticNode('Hello !!')],
      undefined,
      undefined,
      null,
      referencedStyles
    )
  )

  it('Generates styles using CSS', async () => {
    const generator = createVueComponentGenerator()
    const { files } = await generator.generateComponent(uidl)
    const vueFile = findFileByType(files, FileType.VUE)

    expect(vueFile).toBeDefined()
    expect(vueFile?.content).toContain(`class="my-component-container"`)
    expect(vueFile?.content).toContain('@media(max-width: 991px)')
    expect(vueFile?.content).not.toContain('width: 100px')
  })
})

describe('Throws Error when a node is using project-styles but not present in UIDL', () => {
  const styles: UIDLReferencedStyles = {
    '123456789': {
      type: 'style-map',
      content: {
        mapType: 'project-referenced',
        referenceId: 'primaryButton',
      },
    },
  }
  const uidl = component(
    'MyComponent',
    elementNode('container', {}, [], undefined, null, null, styles)
  )

  it('CSS', async () => {
    const generator = createVueComponentGenerator()
    await expect(generator.generateComponent(uidl)).rejects.toThrow(Error)
  })
})

describe('Referes from project style and adds it to the node, without any styles on the node', () => {
  const styles: UIDLReferencedStyles = {
    '123456789': {
      type: 'style-map',
      content: {
        mapType: 'project-referenced',
        referenceId: 'primaryButton',
      },
    },
  }
  const uidl = component(
    'MyComponent',
    elementNode('container', {}, [staticNode('Hello')], undefined, null, null, styles)
  )
  const options: GeneratorOptions = {
    projectStyleSet: {
      styleSetDefinitions: {
        primaryButton: {
          type: 'reusable-project-style-map',
          content: {
            background: staticNode('blue'),
          },
        },
      },
      fileName: 'style',
      path: '..',
    },
  }

  it('CSS', async () => {
    const generator = createVueComponentGenerator()
    const cssOptions: GeneratorOptions = {
      projectStyleSet: {
        ...options.projectStyleSet,
        importFile: true,
      },
    }
    const { files } = await generator.generateComponent(uidl, cssOptions)
    const vueFile = findFileByType(files, FileType.VUE)

    expect(vueFile).toBeDefined()
    expect(vueFile?.content).toContain(`class="primaryButton\"`)
    expect(vueFile?.content).not.toContain(`import '../style.css'`)
  })
})
