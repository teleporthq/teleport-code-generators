import {
  Mapping,
  CompiledComponent,
  GeneratedFolder,
  ProjectStrategy,
  ProjectPluginStructure,
  InMemoryFileRecord,
  ProjectUIDL,
  ReactStyleVariation,
  ProjectPlugin,
  FileType,
} from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import projectUIDL from '../../../examples/test-samples/project-sample.json'
import { DEFAULT_TEMPLATE } from '../src/constants'

export const mockMapping: Mapping = {
  elements: {
    container: {
      elementType: 'mapped-container',
    },
  },
}

const mockedCompiledComponent: CompiledComponent = {
  files: [
    {
      name: 'mock',
      fileType: 'js',
      content: 'const mock = 0;',
    },
  ],
  dependencies: {},
}

export const mockComponentGenerator = () => ({
  addMapping: jest.fn(),
  addPlugin: jest.fn(),
  addPostProcessor: jest.fn(),
  generateComponent: jest.fn().mockImplementation(() => mockedCompiledComponent),
  linkCodeChunks: jest.fn(),
  resolveElement: jest.fn(),
})

const mockRouterGenerator = () => ({
  addMapping: jest.fn(),
  addPlugin: jest.fn(),
  addPostProcessor: jest.fn(),
  generateComponent: jest.fn().mockImplementation(() => mockedCompiledComponent),
  linkCodeChunks: jest.fn(),
  resolveElement: jest.fn(),
})

const mockEntryFileGenerator = () => ({
  addMapping: jest.fn(),
  addPlugin: jest.fn(),
  addPostProcessor: jest.fn(),
  generateComponent: jest.fn(),
  linkCodeChunks: jest.fn().mockImplementation(() => [
    {
      name: 'mock',
      fileType: 'html',
      content: '<html><body>{{root-placeholder}}</body></html>',
    },
  ]),
  resolveElement: jest.fn(),
})

export const createStrategyWithCommonGenerator = () => {
  const strategy: ProjectStrategy = {
    components: {
      generator: mockComponentGenerator,
      path: ['test', 'components'],
      plugins: [],
      postprocessors: [],
      mappings: [],
    },
    pages: {
      generator: mockComponentGenerator,
      path: ['test', 'pages'],
      plugins: [],
      postprocessors: [],
      mappings: [],
    },
    entry: {
      generator: mockEntryFileGenerator,
      path: ['test'],
      plugins: [],
      postprocessors: [],
      mappings: [],
    },
    router: {
      generator: mockRouterGenerator,
      path: ['test'],
      plugins: [],
      postprocessors: [],
      mappings: [],
    },
    static: {
      path: ['test', 'static'],
    },
  }
  return strategy
}

export const createStrategyWithSeparateGenerators = () => {
  const strategy: ProjectStrategy = {
    style: ReactStyleVariation.CSSModules,
    components: {
      generator: mockComponentGenerator,
      path: ['test', 'components'],
      plugins: [],
      postprocessors: [],
      mappings: [],
    },
    pages: {
      generator: mockComponentGenerator,
      path: ['test', 'pages'],
      plugins: [],
      postprocessors: [],
      mappings: [],
    },
    entry: {
      generator: mockEntryFileGenerator,
      path: ['test'],
      fileName: 'mock-filename',
      plugins: [],
      postprocessors: [],
      mappings: [],
    },
    router: {
      generator: mockRouterGenerator,
      path: ['test'],
      fileName: 'mock-filename',
      plugins: [],
      postprocessors: [],
      mappings: [],
    },
    static: {
      prefix: '/static',
      path: ['test', 'static'],
    },
  }
  return strategy
}

export const emptyFolder = (name: string = 'test'): GeneratedFolder => {
  return {
    name,
    files: [],
    subFolders: [],
  }
}

export const folderWithFiles = (name: string = 'test'): GeneratedFolder => {
  return {
    name,
    files: [
      {
        name: 'index',
        fileType: 'js',
        content: 'var x = 0;',
      },
      {
        name: 'index',
        fileType: 'css',
        content: 'h1 { margin: 10px; }',
      },
    ],
    subFolders: [],
  }
}

export const mockAssemblyLineStructure = (): ProjectPluginStructure => {
  const rootFolder = UIDLUtils.cloneObject(DEFAULT_TEMPLATE)

  return {
    uidl: (projectUIDL as unknown) as ProjectUIDL,
    template: DEFAULT_TEMPLATE,
    files: new Map<string, InMemoryFileRecord>(),
    dependencies: {},
    devDependencies: {},
    strategy: createStrategyWithCommonGenerator(),
    rootFolder,
  }
}

class SimpleProjectPluginMock implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const { strategy } = structure
    strategy.style = ReactStyleVariation.CSS
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { dependencies, devDependencies } = structure
    /* tslint:disable:no-string-literal */
    dependencies['react'] = '^16.0.8'
    /* tslint:disable:no-string-literal */
    devDependencies['prop-types'] = '15.7.2'
    return structure
  }
}
export const simplePluginMock = new SimpleProjectPluginMock()

class SimpleProjectPluginMockToInjectFiles implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const { strategy } = structure
    strategy.style = ReactStyleVariation.CSS
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { files } = structure

    files.set('config', {
      path: [],
      files: [
        {
          name: 'next.config',
          fileType: FileType.JSON,
          content: `const withCSS = require('@zeit/next-css')
        module.exports = withCSS({
          cssModules: true
        })`,
        },
      ],
    })

    return structure
  }
}
export const simplePluginMockToInjectFiles = new SimpleProjectPluginMockToInjectFiles()
