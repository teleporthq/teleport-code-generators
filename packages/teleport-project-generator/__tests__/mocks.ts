import { Mapping, CompiledComponent } from '@teleporthq/teleport-types'
import { ProjectStrategy } from '../src/types'

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

const mockComponentGenerator = () => ({
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

const commonGenerator = mockComponentGenerator()

export const firstStrategy: ProjectStrategy = {
  components: {
    generator: commonGenerator,
    path: ['test', 'components'],
  },
  pages: {
    generator: commonGenerator,
    path: ['test', 'pages'],
  },
  entry: {
    generator: mockEntryFileGenerator(),
    path: ['test'],
  },
  router: {
    generator: mockRouterGenerator(),
    path: ['test'],
  },
  static: {
    path: ['test', 'static'],
  },
}

export const secondStrategy: ProjectStrategy = {
  components: {
    generator: mockComponentGenerator(),
    path: ['test', 'components'],
  },
  pages: {
    generator: mockComponentGenerator(),
    path: ['test', 'pages'],
  },
  entry: {
    generator: mockEntryFileGenerator(),
    path: ['test'],
    fileName: 'mock-filename',
  },
  router: {
    generator: mockRouterGenerator(),
    path: ['test'],
    fileName: 'mock-filename',
  },
  static: {
    prefix: '/static',
    path: ['test', 'static'],
  },
}
