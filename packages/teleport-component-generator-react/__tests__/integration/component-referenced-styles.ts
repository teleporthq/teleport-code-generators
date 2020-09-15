import { createReactComponentGenerator } from '../../src'
import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import {
  UIDLReferencedStyles,
  GeneratedFile,
  FileType,
  ReactStyleVariation,
  GeneratorOptions,
} from '@teleporthq/teleport-types'

const findFileByType = (files: GeneratedFile[], type: string = FileType.JS) =>
  files.find((file) => file.fileType === type)

describe('Generates media, pseudo and normal styles', () => {
  const referencedStyles: UIDLReferencedStyles = {
    '1234567890': {
      id: '1234567890',
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
    elementNode('container', null, [staticNode('Hello !!')], null, style, null, referencedStyles)
  )

  it('Generates styles using CSS Modules', async () => {
    const generator = createReactComponentGenerator()
    const { files } = await generator.generateComponent(uidl)
    const cssFile = findFileByType(files, FileType.CSS)
    const jsFile = findFileByType(files, FileType.JS)

    expect(cssFile).toBeDefined()
    expect(cssFile.content).toContain('@media(max-width: 991px)')
    expect(cssFile.content).toContain('width: 100px')

    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain('className={styles.container}')
    expect(jsFile.content).toContain(`import styles from './my-component.module.css`)
  })

  it('Generates styles using CSS', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.CSS)
    const { files } = await generator.generateComponent(uidl)
    const cssFile = findFileByType(files, FileType.CSS)
    const jsFile = findFileByType(files, FileType.JS)

    expect(cssFile).toBeDefined()
    expect(cssFile.content).toContain('@media(max-width: 991px)')
    expect(cssFile.content).toContain('width: 100px')

    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain(`className="my-component-container"`)
    expect(jsFile.content).toContain(`import './my-component.css`)
  })

  it('Generates styles using Styled-Components', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.StyledComponents)
    const { files } = await generator.generateComponent(uidl)
    const cssFile = findFileByType(files, FileType.CSS)
    const jsFile = findFileByType(files, FileType.JS)

    expect(cssFile).not.toBeDefined()
    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain(`<Container>Hello !!</Container>`)
    expect(jsFile.content).toContain(`const Container = styled.div`)
    expect(jsFile.content).toContain(`width: 100px`)
    expect(jsFile.content).toContain(`display: none`)
  })

  it('Generates styles using ReactJSS', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.ReactJSS)
    const { files } = await generator.generateComponent(uidl)
    const cssFile = findFileByType(files, FileType.CSS)
    const jsFile = findFileByType(files, FileType.JS)

    expect(cssFile).not.toBeDefined()
    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain(`className={props.classes['container']}`)
    expect(jsFile.content).toContain(`container: {`)
    expect(jsFile.content).toContain(`width: '100px'`)
    expect(jsFile.content).toContain(`display: 'none'`)
  })

  it('Generates styles using StyledJSX', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.StyledJSX)
    const { files } = await generator.generateComponent(uidl)
    const cssFile = findFileByType(files, FileType.CSS)
    const jsFile = findFileByType(files, FileType.JS)

    expect(cssFile).not.toBeDefined()
    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain(`className="container"`)
    expect(jsFile.content).toContain(`.container {`)
    expect(jsFile.content).toContain(`width: 100px`)
    expect(jsFile.content).toContain(`display: none`)
  })
})

describe('Add referenced styles even when direct styles are not present on node', () => {
  const referencedStyles: UIDLReferencedStyles = {
    '1234567890': {
      id: '1234567890',
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
    elementNode('container', null, [staticNode('Hello !!')], null, null, null, referencedStyles)
  )

  it('Generates styles using CSS Modules', async () => {
    const generator = createReactComponentGenerator()
    const { files } = await generator.generateComponent(uidl)
    const cssFile = findFileByType(files, FileType.CSS)
    const jsFile = findFileByType(files, FileType.JS)

    expect(cssFile).toBeDefined()
    expect(cssFile.content).toContain('@media(max-width: 991px)')
    expect(cssFile.content).not.toContain('width: 100px')

    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain('className={styles.container}')
    expect(jsFile.content).toContain(`import styles from './my-component.module.css`)
  })

  it('Generates styles using CSS', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.CSS)
    const { files } = await generator.generateComponent(uidl)
    const cssFile = findFileByType(files, FileType.CSS)
    const jsFile = findFileByType(files, FileType.JS)

    expect(cssFile).toBeDefined()
    expect(cssFile.content).toContain('@media(max-width: 991px)')
    expect(cssFile.content).not.toContain('width: 100px')

    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain(`className="my-component-container"`)
    expect(jsFile.content).toContain(`import './my-component.css`)
  })

  it('Generates styles using Styled-Components', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.StyledComponents)
    const { files } = await generator.generateComponent(uidl)
    const cssFile = findFileByType(files, FileType.CSS)
    const jsFile = findFileByType(files, FileType.JS)

    expect(cssFile).not.toBeDefined()
    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain(`<Container>Hello !!</Container>`)
    expect(jsFile.content).toContain(`const Container = styled.div`)
    expect(jsFile.content).not.toContain(`width: 100px`)
    expect(jsFile.content).toContain(`display: none`)
  })

  it('Generates styles using ReactJSS', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.ReactJSS)
    const { files } = await generator.generateComponent(uidl)
    const cssFile = findFileByType(files, FileType.CSS)
    const jsFile = findFileByType(files, FileType.JS)

    expect(cssFile).not.toBeDefined()
    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain(`className={props.classes['container']}`)
    expect(jsFile.content).toContain(`container: {`)
    expect(jsFile.content).not.toContain(`width: '100px'`)
    expect(jsFile.content).toContain(`display: 'none'`)
  })

  it('Generates styles using StyledJSX', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.StyledJSX)
    const { files } = await generator.generateComponent(uidl)
    const cssFile = findFileByType(files, FileType.CSS)
    const jsFile = findFileByType(files, FileType.JS)

    expect(cssFile).not.toBeDefined()
    expect(jsFile).toBeDefined()
    expect(jsFile.content).toContain(`className="container"`)
    expect(jsFile.content).toContain(`container {`)
    expect(jsFile.content).not.toContain(`width: '100px'`)
    expect(jsFile.content).toContain(`display: none`)
  })
})

describe('Throws Error when a node is using project-styles but not present in UIDL', () => {
  const styles: UIDLReferencedStyles = {
    '123456789': {
      id: '123456789',
      type: 'style-map',
      content: {
        mapType: 'project-referenced',
        referenceId: '987654321',
      },
    },
  }
  const uidl = component(
    'MyComponent',
    elementNode('container', null, [], null, null, null, styles)
  )

  it('CSS Modules', async () => {
    const generator = createReactComponentGenerator()
    await expect(generator.generateComponent(uidl)).rejects.toThrow(Error)
  })

  it('CSS', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.CSS)
    await expect(generator.generateComponent(uidl)).rejects.toThrow(Error)
  })

  it('Styled Components', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.StyledComponents)
    await expect(generator.generateComponent(uidl)).rejects.toThrow(Error)
  })

  it('Styled JSX', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.StyledJSX)
    await expect(generator.generateComponent(uidl)).rejects.toThrow(Error)
  })

  it('React JSS', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.ReactJSS)
    await expect(generator.generateComponent(uidl)).rejects.toThrow(Error)
  })
})

describe('Referes from project style and adds it to the node, without any styles on the node', () => {
  const styles: UIDLReferencedStyles = {
    '123456789': {
      id: '123456789',
      type: 'style-map',
      content: {
        mapType: 'project-referenced',
        referenceId: '987654321',
      },
    },
  }
  const uidl = component(
    'MyComponent',
    elementNode('container', null, [staticNode('Hello')], null, null, null, styles)
  )
  const options: GeneratorOptions = {
    projectStyleSet: {
      styleSetDefinitions: {
        '987654321': {
          id: '987654321',
          type: 'reusable-project-style-map',
          name: 'primaryButton',
          content: {
            background: staticNode('blue'),
          },
        },
      },
      fileName: 'style',
      path: '..',
    },
  }

  it('CSS-Modules', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.CSSModules)
    const { files } = await generator.generateComponent(uidl, options)
    const jsFile = findFileByType(files, FileType.JS)

    expect(jsFile.content).toContain('className={projectStyles.primaryButton}')
    expect(jsFile.content).toContain(`import projectStyles from '../style.module.css'`)
    expect(jsFile.content).not.toContain(`import styles from './my-component.module.css'`)
  })

  it('CSS', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.CSS)
    const cssOptions: GeneratorOptions = {
      projectStyleSet: {
        ...options.projectStyleSet,
        importFile: true,
      },
    }

    const { files } = await generator.generateComponent(uidl, cssOptions)
    const jsFile = findFileByType(files, FileType.JS)

    expect(jsFile.content).toContain('className="primaryButton"')
    expect(jsFile.content).toContain(`import '../style.css'`)
    expect(jsFile.content).not.toContain(`import './my-component.css'`)
  })

  it('StyledComponents', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.StyledComponents)

    const { files } = await generator.generateComponent(uidl, options)
    const jsFile = findFileByType(files, FileType.JS)

    expect(jsFile.content).toContain('<Container>Hello</Container>')
    expect(jsFile.content).toContain('${PrimaryButton')
    expect(jsFile.content).toContain(`import { PrimaryButton } from '../style'`)
    expect(jsFile.content).toContain('const Container = styled.div`')
  })

  it('Styled JSX', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.StyledJSX)

    const { files } = await generator.generateComponent(uidl, options)
    const jsFile = findFileByType(files, FileType.JS)
    // Styled JSX is used only with NextJS, for NextJS we don't need to import anything
    expect(jsFile.content).toContain('<div className="primaryButton">')
  })

  it('React JSS', async () => {
    const generator = createReactComponentGenerator(ReactStyleVariation.ReactJSS)

    const { files } = await generator.generateComponent(uidl, options)
    const jsFile = findFileByType(files, FileType.JS)

    expect(jsFile.content).toContain(`div className={projectStyles['primaryButton']}>`)
    expect(jsFile.content).toContain(`const projectStyles = useProjectStyles()`)
    expect(jsFile.content).toContain(`import { useProjectStyles } from '../style'`)
  })
})
