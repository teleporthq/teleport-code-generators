import {
  generateLocalDependenciesPrefix,
  injectFilesToPath,
  extractPageOptions,
} from '../src/utils'
import { UIDLStateDefinition } from '@teleporthq/teleport-types'
import { emptyFolder, folderWithFiles } from './mocks'

describe('generateLocalDependenciesPrefix', () => {
  it('works when there is a common parent', () => {
    const from = ['src', 'from']
    const to = ['src', 'to']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('../to/')
  })

  it('works when there is no common parent', () => {
    const from = ['dist', 'from']
    const to = ['src', 'to']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('../../src/to/')
  })

  it('works when to is a parent of from', () => {
    const from = ['src', 'from']
    const to = ['src']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('../')
  })

  it('works when to is a child of from', () => {
    const from = ['src']
    const to = ['src', 'to']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('./to/')
  })

  it('works when they are identical', () => {
    const from = ['src', 'from']
    const to = ['src', 'from']

    expect(generateLocalDependenciesPrefix(from, to)).toBe('./')
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
    const result = extractPageOptions(routeDefinitions, 'non-declared')
    expect(result.navLink).toBe('/non-declared')
    expect(result.fileName).toBe('non-declared')
    expect(result.componentName).toBe('NonDeclared')
  })

  it('uses the state for a page without meta', () => {
    const result = extractPageOptions(routeDefinitions, 'no-meta')
    expect(result.navLink).toBe('/no-meta')
    expect(result.fileName).toBe('no-meta')
    expect(result.componentName).toBe('NoMeta')
  })

  it('returns values from the meta with defaults from the state', () => {
    const result = extractPageOptions(routeDefinitions, 'about')
    expect(result.navLink).toBe('/about-us') // meta value
    expect(result.fileName).toBe('about') // state value
    expect(result.componentName).toBe('AboutUs') // meta value
  })

  it('converts the fileName to index', () => {
    const result = extractPageOptions(routeDefinitions, 'home', true)
    expect(result.navLink).toBe('/')
    expect(result.fileName).toBe('index')
    expect(result.componentName).toBe('Home')
  })

  it('uses the path as the fileName', () => {
    const result = extractPageOptions(routeDefinitions, 'about', true)
    expect(result.navLink).toBe('/about-us')
    expect(result.fileName).toBe('about-us')
    expect(result.componentName).toBe('AboutUs')
  })
})
