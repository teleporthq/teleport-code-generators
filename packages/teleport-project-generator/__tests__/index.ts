import { ProjectUIDL } from '@teleporthq/teleport-types'
import { createProjectGenerator } from '../src'
import { resolveLocalDependencies } from '../src/utils'
import {
  mockMapping,
  createStrategyWithCommonGenerator,
  createStrategyWithSeparateGenerators,
} from './mocks'

import projectUIDL from '../../../examples/test-samples/project-sample.json'

describe('Generic Project Generator', () => {
  describe('with the same component generator for pages and components', () => {
    const strategy = createStrategyWithCommonGenerator()
    const generator = createProjectGenerator(strategy)
    const { generator: componentsGenerator } = strategy.components
    const { generator: routerGenerator } = strategy.router
    const { generator: entryGenerator } = strategy.entry

    it('creates an instance of a project generator', () => {
      expect(generator.generateProject).toBeDefined()
      expect(generator.getAssetsPath).toBeDefined()
      expect(generator.addMapping).toBeDefined()
    })

    it('sets the default assets prefix', () => {
      expect(generator.getAssetsPath()).toBe('test/static')
    })

    it('sends the mapping to the component generators', () => {
      generator.addMapping(mockMapping)
      expect(componentsGenerator.addMapping).toBeCalledTimes(1)
      expect(componentsGenerator.addMapping).toBeCalledWith(mockMapping)
    })

    it('calls the generators according to the strategy', async () => {
      const result = await generator.generateProject(projectUIDL)

      const uidl = projectUIDL as ProjectUIDL

      // This adds the local dependencies on the UIDL, so we can proper assert below
      resolveLocalDependencies([], uidl.components, strategy)

      expect(componentsGenerator.generateComponent).toBeCalledTimes(7)
      expect(componentsGenerator.generateComponent).toBeCalledWith(
        expect.objectContaining({ name: 'ExpandableArea' }),
        {
          assetsPrefix: '/test/static',
          projectRouteDefinition: uidl.root.stateDefinitions.route,
          mapping: {},
          skipValidation: true,
        }
      )
      expect(entryGenerator.linkCodeChunks).toBeCalledTimes(1)
      expect(routerGenerator.generateComponent).toBeCalledTimes(1)

      const routerUIDL = {
        ...uidl.root,
        meta: {
          fileName: 'index',
        },
      }

      expect(routerGenerator.generateComponent).toBeCalledWith(
        routerUIDL,
        expect.objectContaining({
          localDependenciesPrefix: './pages/',
        })
      )

      const componentFile = result.subFolders[0].subFolders[1].files[0]
      expect(componentFile.name).toBe('mock')
    })
  })

  describe('with the different component generators', () => {
    const strategy = createStrategyWithSeparateGenerators()
    const generator = createProjectGenerator(strategy)
    const { generator: componentsGenerator } = strategy.components
    const { generator: pagesGenerator } = strategy.pages
    const { generator: routerGenerator } = strategy.router
    const { generator: entryGenerator } = strategy.entry

    it('creates an instance of a project generator', () => {
      expect(generator.generateProject).toBeDefined()
      expect(generator.getAssetsPath).toBeDefined()
      expect(generator.addMapping).toBeDefined()
    })

    it('sets the default assets prefix', () => {
      expect(generator.getAssetsPath()).toBe('test/static')
    })

    it('sends the mapping to the component generators', () => {
      generator.addMapping(mockMapping)
      expect(componentsGenerator.addMapping).toBeCalledTimes(1)
      expect(componentsGenerator.addMapping).toBeCalledWith(mockMapping)
      expect(pagesGenerator.addMapping).toBeCalledTimes(1)
      expect(pagesGenerator.addMapping).toBeCalledWith(mockMapping)
    })

    it('calls the generators according to the strategy', async () => {
      await generator.generateProject(projectUIDL)

      const uidl = projectUIDL as ProjectUIDL

      // This adds the local dependencies on the UIDL, so we can proper assert below
      resolveLocalDependencies([], uidl.components, strategy)

      expect(componentsGenerator.generateComponent).toBeCalledTimes(4)
      expect(componentsGenerator.generateComponent).toBeCalledWith(
        expect.objectContaining({ name: 'ExpandableArea' }),
        {
          assetsPrefix: '/static',
          projectRouteDefinition: uidl.root.stateDefinitions.route,
          mapping: {},
          skipValidation: true,
        }
      )
      expect(pagesGenerator.generateComponent).toBeCalledTimes(3)
      expect(pagesGenerator.generateComponent).toBeCalledWith(
        expect.objectContaining({
          name: 'Home',
        }),
        {
          assetsPrefix: '/static',
          projectRouteDefinition: uidl.root.stateDefinitions.route,
          mapping: {},
          skipValidation: true,
        }
      )
      expect(entryGenerator.linkCodeChunks).toBeCalledTimes(1)

      const routerUIDL = {
        ...uidl.root,
        meta: {
          fileName: strategy.router.fileName,
        },
      }

      expect(routerGenerator.generateComponent).toBeCalledTimes(1)
      expect(routerGenerator.generateComponent).toBeCalledWith(
        routerUIDL,
        expect.objectContaining({
          localDependenciesPrefix: './pages/',
        })
      )
    })
  })

  describe('with custom generation options', () => {
    const strategy = createStrategyWithCommonGenerator()
    strategy.components.options = {
      createFolderForEachComponent: true,
      customComponentFileName: 'component',
      customStyleFileName: 'style',
    }

    const generator = createProjectGenerator(strategy)
    const { generator: componentsGenerator } = strategy.components
    const { generator: routerGenerator } = strategy.router
    const { generator: entryGenerator } = strategy.entry

    it('calls the generators according to the strategy', async () => {
      const result = await generator.generateProject(projectUIDL)

      const uidl = projectUIDL as ProjectUIDL

      // This adds the local dependencies on the UIDL, so we can proper assert below
      resolveLocalDependencies([], uidl.components, strategy)

      expect(componentsGenerator.generateComponent).toBeCalledTimes(7)
      expect(componentsGenerator.generateComponent).toBeCalledWith(
        expect.objectContaining({ name: 'ExpandableArea' }),
        {
          assetsPrefix: '/test/static',
          projectRouteDefinition: uidl.root.stateDefinitions.route,
          mapping: {},
          skipValidation: true,
        }
      )
      expect(entryGenerator.linkCodeChunks).toBeCalledTimes(1)
      expect(routerGenerator.generateComponent).toBeCalledTimes(1)

      const routerUIDL = {
        ...uidl.root,
        meta: {
          fileName: 'index',
        },
      }

      expect(routerGenerator.generateComponent).toBeCalledWith(
        routerUIDL,
        expect.objectContaining({
          localDependenciesPrefix: './pages/',
        })
      )

      const componentFolder = result.subFolders[0].subFolders[1].subFolders[0]
      expect(componentFolder.name).toBe('one-component')
    })
  })
})
