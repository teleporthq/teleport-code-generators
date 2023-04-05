import { injectFilesToPath, extractPageOptions, prepareComponentOutputOptions } from '../src/utils'
import { UIDLStateDefinition } from '@teleporthq/teleport-types'
import { emptyFolder, folderWithFiles, createStrategyWithCommonGenerator } from './mocks'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import { GenericUtils } from '@teleporthq/teleport-shared'

describe('generateLocalDependenciesPrefix', () => {
  it('works when there is a common parent', () => {
    const from = ['src', 'from']
    const to = ['src', 'to']

    expect(GenericUtils.generateLocalDependenciesPrefix(from, to)).toBe('../to/')
  })

  it('works when there is no common parent', () => {
    const from = ['dist', 'from']
    const to = ['src', 'to']

    expect(GenericUtils.generateLocalDependenciesPrefix(from, to)).toBe('../../src/to/')
  })

  it('works when to is a parent of from', () => {
    const from = ['src', 'from']
    const to = ['src']

    expect(GenericUtils.generateLocalDependenciesPrefix(from, to)).toBe('../')
  })

  it('works when to is a child of from', () => {
    const from = ['src']
    const to = ['src', 'to']

    expect(GenericUtils.generateLocalDependenciesPrefix(from, to)).toBe('./to/')
  })

  it('works when they are identical', () => {
    const from = ['src', 'from']
    const to = ['src', 'from']

    expect(GenericUtils.generateLocalDependenciesPrefix(from, to)).toBe('./')
  })
})

describe('injectFilesToPath', () => {
  it('adds a file in an empty folder', () => {
    const folder = emptyFolder()
    const newFile = {
      name: 'test',
      fileType: 'js',
      content: 'random',
    }

    injectFilesToPath(folder, [], [newFile])

    expect(folder.files.length).toBe(1)
    expect(folder.files[0].name).toBe('test')
    expect(folder.files[0].fileType).toBe('js')
    expect(folder.files[0].content).toBe('random')
  })

  it('adds a file in a folder with existing files', () => {
    const folder = folderWithFiles()
    const newFile = {
      name: 'test',
      fileType: 'js',
      content: 'random',
    }

    injectFilesToPath(folder, [], [newFile])

    expect(folder.files.length).toBe(3)
    expect(folder.files[2].name).toBe('test')
    expect(folder.files[2].fileType).toBe('js')
    expect(folder.files[2].content).toBe('random')
  })

  it('overrides existing files', () => {
    const folder = folderWithFiles()
    const newFiles = [
      {
        name: 'index',
        fileType: 'js',
        content: 'new-content',
      },
      {
        name: 'index',
        fileType: 'html',
        content: '<html>',
      },
    ]

    injectFilesToPath(folder, [], newFiles)

    expect(folder.files.length).toBe(3)
    expect(folder.files[0].name).toBe('index')
    expect(folder.files[0].fileType).toBe('js')
    expect(folder.files[0].content).toBe('new-content')
    expect(folder.files[1].name).toBe('index')
    expect(folder.files[1].fileType).toBe('css')
    expect(folder.files[1].content).toBe('h1 { margin: 10px; }')
    expect(folder.files[2].name).toBe('index')
    expect(folder.files[2].fileType).toBe('html')
    expect(folder.files[2].content).toBe('<html>')
  })

  it('adds the files in a newly created subfolder', () => {
    const folder = folderWithFiles()
    const newFiles = [
      {
        name: 'index',
        fileType: 'js',
        content: 'new-content',
      },
      {
        name: 'index',
        fileType: 'html',
        content: '<html>',
      },
    ]

    injectFilesToPath(folder, ['subfolder'], newFiles)

    expect(folder.files.length).toBe(2)
    expect(folder.files[0].name).toBe('index')
    expect(folder.files[0].fileType).toBe('js')
    expect(folder.files[0].content).toBe('var x = 0;')
    expect(folder.files[1].name).toBe('index')
    expect(folder.files[1].fileType).toBe('css')
    expect(folder.files[1].content).toBe('h1 { margin: 10px; }')

    expect(folder.subFolders[0].name).toBe('subfolder')
    expect(folder.subFolders[0].files.length).toBe(2)
    expect(folder.subFolders[0].files[0].name).toBe('index')
    expect(folder.subFolders[0].files[0].fileType).toBe('js')
    expect(folder.subFolders[0].files[0].content).toBe('new-content')
    expect(folder.subFolders[0].files[1].name).toBe('index')
    expect(folder.subFolders[0].files[1].fileType).toBe('html')
    expect(folder.subFolders[0].files[1].content).toBe('<html>')
  })
})

describe('extractPageOptions', () => {
  const routeDefinitions: UIDLStateDefinition = {
    type: 'string',
    defaultValue: 'home',
    values: [
      {
        value: 'home',
        pageOptions: {
          navLink: '/',
        },
      },
      {
        value: 'about',
        pageOptions: {
          navLink: '/about-us',
          componentName: 'AboutUs',
        },
      },
      {
        value: 'contact-us',
        pageOptions: {
          navLink: '/team',
        },
      },
      {
        value: 'no-meta',
      },
    ],
  }

  it('uses the state for a non-declared page', () => {
    const { pageOptions } = extractPageOptions(routeDefinitions, 'non-declared')
    expect(pageOptions.navLink).toBe('/non-declared')
    expect(pageOptions.fileName).toBe('non-declared')
    expect(pageOptions.componentName).toBe('NonDeclared')
  })

  it('uses the state for a page without meta', () => {
    const { pageOptions } = extractPageOptions(routeDefinitions, 'no-meta')
    expect(pageOptions.navLink).toBe('/no-meta')
    expect(pageOptions.fileName).toBe('no-meta')
    expect(pageOptions.componentName).toBe('NoMeta')
  })

  it('returns values from the meta with defaults from the state', () => {
    const { pageOptions } = extractPageOptions(routeDefinitions, 'about')
    expect(pageOptions.navLink).toBe('/about-us') // meta value
    expect(pageOptions.fileName).toBe('about') // state value
    expect(pageOptions.componentName).toBe('AboutUs') // meta value
  })

  it('converts the fileName to index', () => {
    const { pageOptions } = extractPageOptions(routeDefinitions, 'home', true)
    expect(pageOptions.navLink).toBe('/')
    expect(pageOptions.fileName).toBe('index')
    expect(pageOptions.componentName).toBe('Home')
  })

  it('uses the path as the fileName', () => {
    const { pageOptions } = extractPageOptions(routeDefinitions, 'about', true)
    expect(pageOptions.navLink).toBe('/about-us')
    expect(pageOptions.fileName).toBe('about-us')
    expect(pageOptions.componentName).toBe('AboutUs')
  })
})

describe('prepareComponentOutputOptions', () => {
  it('creates all output options based on the UIDL and the default conventions', () => {
    const mockStrategy = createStrategyWithCommonGenerator()
    const components = {
      NavBar: component('NavBar', elementNode('container')),
      'Primary Button': component('Primary Button', elementNode('container')),
      'my-card': component('my-card', elementNode('container')),
    }

    prepareComponentOutputOptions(components, mockStrategy)

    expect(components.NavBar.outputOptions.fileName).toBe('nav-bar')
    expect(components.NavBar.outputOptions.componentClassName).toBe('NavBar')
    expect(components['Primary Button'].outputOptions.fileName).toBe('primary-button')
    expect(components['Primary Button'].outputOptions.componentClassName).toBe('PrimaryButton')
    expect(components['my-card'].outputOptions.fileName).toBe('my-card')
    expect(components['my-card'].outputOptions.componentClassName).toBe('MyCard')
  })

  it('works with components created in separate folders', () => {
    const mockStrategy = createStrategyWithCommonGenerator()
    mockStrategy.components.options = {
      createFolderForEachComponent: true,
      customStyleFileName: () => 'styling',
    }
    const components = {
      NavBar: component('NavBar', elementNode('container')),
      'Primary Button': component('Primary Button', elementNode('container')),
      'my-card': component('my-card', elementNode('container')),
    }

    prepareComponentOutputOptions(components, mockStrategy)

    expect(components.NavBar.outputOptions.folderPath[0]).toBe('nav-bar')
    expect(components.NavBar.outputOptions.fileName).toBe('index')
    expect(components.NavBar.outputOptions.componentClassName).toBe('NavBar')
    expect(components.NavBar.outputOptions.styleFileName).toBe('styling')
    expect(components['Primary Button'].outputOptions.folderPath[0]).toBe('primary-button')
    expect(components['Primary Button'].outputOptions.fileName).toBe('index')
    expect(components['Primary Button'].outputOptions.componentClassName).toBe('PrimaryButton')
    expect(components['Primary Button'].outputOptions.styleFileName).toBe('styling')
    expect(components['my-card'].outputOptions.folderPath[0]).toBe('my-card')
    expect(components['my-card'].outputOptions.fileName).toBe('index')
    expect(components['my-card'].outputOptions.componentClassName).toBe('MyCard')
    expect(components['my-card'].outputOptions.styleFileName).toBe('styling')
  })

  it('uses the UIDL values', () => {
    const mockStrategy = createStrategyWithCommonGenerator()
    mockStrategy.components.options = {
      createFolderForEachComponent: true,
      customStyleFileName: () => 'styling',
    }
    const testComponent = component('NavBar', elementNode('container'))
    testComponent.outputOptions = {
      fileName: 'custom-filename',
      folderPath: ['custom-folder'],
    }
    const components = {
      testComponent,
    }

    prepareComponentOutputOptions(components, mockStrategy)

    expect(testComponent.outputOptions.fileName).toBe('index')
    expect(testComponent.outputOptions.folderPath[0]).toBe('custom-folder')
    expect(testComponent.outputOptions.folderPath[1]).toBe('custom-filename')
  })

  it('deduplicates matching names', () => {
    const mockStrategy = createStrategyWithCommonGenerator()
    const components = {
      'te sT': component('te sT', elementNode('container')),
      'Tes t': component('Tes t', elementNode('container')),
      test: component('test', elementNode('container')),
    }

    prepareComponentOutputOptions(components, mockStrategy)

    expect(components['te sT'].outputOptions.fileName).toBe('tes-t')
    expect(components['Tes t'].outputOptions.fileName).toBe('test')
    expect(components.test.outputOptions.fileName).toBe('test1')

    expect(components['te sT'].outputOptions.componentClassName).toBe('TesT')
    expect(components['Tes t'].outputOptions.componentClassName).toBe('Test')
    expect(components.test.outputOptions.componentClassName).toBe('Test1')
  })
})
