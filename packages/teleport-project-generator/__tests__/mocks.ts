import {
  Mapping,
  CompiledComponent,
  GeneratedFolder,
  ProjectStrategy,
} from '@teleporthq/teleport-types'

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
