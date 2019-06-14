import { Mapping, CompiledComponent } from '@teleporthq/teleport-types'

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

const commonGenerator = {
  addMapping: jest.fn(),
  addPlugin: jest.fn(),
  addPostProcessor: jest.fn(),
  generateComponent: jest.fn().mockImplementation(() => mockedCompiledComponent),
  linkCodeChunks: jest.fn(),
  resolveElement: jest.fn(),
}

export const firstStrategy = {
  components: {
    generator: commonGenerator,
    path: ['test', 'components'],
  },
  pages: {
    generator: commonGenerator,
    path: ['test', 'pages'],
  },
  entry: {
    generatorFunction: jest.fn(),
    path: ['test'],
  },
  router: {
    generatorFunction: jest.fn(),
    path: ['test'],
  },
  static: {
    path: ['test', 'static'],
  },
}

export const secondStrategy = {
  components: {
    generator: {
      addMapping: jest.fn(),
      addPlugin: jest.fn(),
      addPostProcessor: jest.fn(),
      generateComponent: jest.fn().mockImplementation(() => mockedCompiledComponent),
      linkCodeChunks: jest.fn(),
      resolveElement: jest.fn(),
    },
    path: ['test', 'components'],
  },
  pages: {
    generator: {
      addMapping: jest.fn(),
      addPlugin: jest.fn(),
      addPostProcessor: jest.fn(),
      generateComponent: jest.fn().mockImplementation(() => mockedCompiledComponent),
      linkCodeChunks: jest.fn(),
      resolveElement: jest.fn(),
    },
    path: ['test', 'pages'],
  },
  entry: {
    generatorFunction: jest.fn(),
    path: ['test'],
  },
  router: {
    generatorFunction: jest.fn(),
    path: ['test'],
  },
  static: {
    prefix: '/static',
    path: ['test', 'static'],
  },
}
