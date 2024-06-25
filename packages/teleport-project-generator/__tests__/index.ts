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

    it('creates an instance of a project generator', () => {
      expect(generator.generateProject).toBeDefined()
      expect(generator.getAssetsPath).toBeDefined()
      expect(generator.addMapping).toBeDefined()
    })

    it('sets the default assets prefix', () => {
      expect(generator.getAssetsPath()[0]).toBe('test')
      expect(generator.getAssetsPath()[1]).toBe('static')
    })

    it('sends the mapping to the component generators', () => {
      generator.addMapping(mockMapping)

      expect(strategy.components.mappings.length).toBe(1)
      expect(strategy.components.mappings[0]).toBe(mockMapping)
      expect(strategy.pages.mappings.length).toBe(1)
      expect(strategy.pages.mappings[0]).toBe(mockMapping)
    })

    it('calls the generators according to the strategy', async () => {
      const result = await generator.generateProject(projectUIDL)
      const uidl = projectUIDL as unknown as ProjectUIDL

      // This adds the local dependencies on the UIDL, so we can proper assert below
      resolveLocalDependencies([], uidl.components, strategy)
      expect(generator.componentGenerator).toBeDefined()
      expect(generator.pageGenerator).toBeDefined()
      expect(generator.pageGenerator.generateComponent).toBeCalledTimes(3)
      expect(generator.componentGenerator.generateComponent).toBeCalledTimes(4)
      expect(generator.componentGenerator.generateComponent).toBeCalledWith(
        expect.objectContaining({ name: 'ExpandableArea' }),
        expect.objectContaining({
          assets: {
            identifier: null,
            mappings: {},
            prefix: '/test/static',
            fontsFolder: 'test/static/fonts',
            localFonts: [],
          },
          designLanguage: undefined,
          mapping: {},
          extractedResources: {},
          skipValidation: true,
        })
      )
      expect(generator.routerGenerator.generateComponent).toBeCalledTimes(1)

      const routerUIDL = {
        ...uidl.root,
        styleSetDefinitions: {},
        outputOptions: {
          fileName: 'index',
        },
      }

      expect(generator.routerGenerator.generateComponent).toBeCalledWith(
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

    it('creates an instance of a project generator', () => {
      expect(generator.generateProject).toBeDefined()
      expect(generator.getAssetsPath).toBeDefined()
      expect(generator.addMapping).toBeDefined()
    })

    it('sets the default assets prefix', () => {
      expect(generator.getAssetsPath()[0]).toBe('test')
      expect(generator.getAssetsPath()[1]).toBe('static')
    })

    it('sends the mapping to the component generators', () => {
      generator.addMapping(mockMapping)
      expect(strategy.components.mappings.length).toBe(1)
      expect(strategy.components.mappings[0]).toBe(mockMapping)
    })

    it('calls the generators according to the strategy', async () => {
      await generator.generateProject(projectUIDL)
      const uidl = projectUIDL as unknown as ProjectUIDL

      // This adds the local dependencies on the UIDL, so we can proper assert below
      resolveLocalDependencies([], uidl.components, strategy)

      expect(generator.componentGenerator.generateComponent).toBeCalledTimes(4)
      expect(generator.componentGenerator.generateComponent).toBeCalledWith(
        expect.objectContaining({ name: 'ExpandableArea' }),
        {
          assets: {
            identifier: null,
            mappings: {},
            prefix: '/static',
            fontsFolder: 'test/static/fonts',
            localFonts: [],
          },
          designLanguage: undefined,
          projectRouteDefinition: uidl.root.stateDefinitions.route,
          extractedResources: {},
          mapping: {},
          skipValidation: true,
        }
      )
      expect(generator.pageGenerator.generateComponent).toBeCalledTimes(3)
      expect(generator.pageGenerator.generateComponent).toBeCalledWith(
        expect.objectContaining({
          name: 'Home',
        }),
        {
          assets: {
            identifier: null,
            mappings: {},
            prefix: '/static',
            fontsFolder: 'test/static/fonts',
            localFonts: [],
          },
          designLanguage: undefined,
          projectRouteDefinition: uidl.root.stateDefinitions.route,
          extractedResources: {},
          mapping: {},
          skipValidation: true,
        }
      )

      const routerUIDL = {
        ...uidl.root,
        styleSetDefinitions: {},
        outputOptions: {
          fileName: strategy.router.fileName,
        },
      }

      expect(generator.routerGenerator.generateComponent).toBeCalledTimes(1)
      expect(generator.routerGenerator.generateComponent).toBeCalledWith(
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
      customComponentFileName: (_) => 'component',
      customStyleFileName: (_) => 'style',
    }
    const generator = createProjectGenerator(strategy)

    it('calls the generators according to the strategy', async () => {
      const result = await generator.generateProject(projectUIDL)

      const uidl = projectUIDL as unknown as ProjectUIDL

      // This adds the local dependencies on the UIDL, so we can proper assert below
      resolveLocalDependencies([], uidl.components, strategy)
      expect(generator.componentGenerator).toBeDefined()
      expect(generator.pageGenerator).toBeDefined()
      expect(generator.componentGenerator.generateComponent).toBeCalledTimes(4)
      expect(generator.pageGenerator.generateComponent).toBeCalledTimes(3)
      expect(generator.componentGenerator.generateComponent).toBeCalledWith(
        expect.objectContaining({ name: 'ExpandableArea' }),
        {
          assets: {
            identifier: null,
            mappings: {},
            prefix: '/test/static',
            fontsFolder: 'test/static/fonts',
            localFonts: [],
          },
          extractedResources: {},
          designLanguage: undefined,
          projectRouteDefinition: uidl.root.stateDefinitions.route,
          mapping: {},
          skipValidation: true,
        }
      )

      expect(generator.routerGenerator.generateComponent).toBeCalledTimes(1)

      const routerUIDL = {
        ...uidl.root,
        styleSetDefinitions: {},
        outputOptions: {
          fileName: 'index',
        },
      }

      expect(generator.routerGenerator.generateComponent).toBeCalledWith(
        routerUIDL,
        expect.objectContaining({
          localDependenciesPrefix: './pages/',
        })
      )

      const componentFolder = result.subFolders[0].subFolders[1].subFolders[0]
      expect(componentFolder.name).toBe('one-component')
    })
  })

  describe('updateComponentsStrategy', () => {
    it('changes the internal strategy object when no options are passed', () => {
      const generator = createProjectGenerator(createStrategyWithCommonGenerator())
      generator.updateComponentsStrategy({
        options: {
          createFolderForEachComponent: true,
        },
      })

      const strategy = generator.getStrategy()

      expect(strategy.components.options.createFolderForEachComponent).toBe(true)
    })

    it('overrides existing options', () => {
      const initialStrategy = createStrategyWithCommonGenerator()
      initialStrategy.components.options = {
        createFolderForEachComponent: false,
      }
      const generator = createProjectGenerator(initialStrategy)

      generator.updateComponentsStrategy({
        options: {
          createFolderForEachComponent: true,
        },
      })

      const strategy = generator.getStrategy()

      expect(strategy.components.options.createFolderForEachComponent).toBe(true)
    })
  })

  describe('updatePagesStrategy', () => {
    it('changes the internal strategy object when no options are passed', () => {
      const generator = createProjectGenerator(createStrategyWithCommonGenerator())
      generator.updatePagesStrategy({
        options: {
          createFolderForEachComponent: true,
        },
      })

      const strategy = generator.getStrategy()

      expect(strategy.pages.options.createFolderForEachComponent).toBe(true)
    })

    it('overrides existing options', () => {
      const initialStrategy = createStrategyWithCommonGenerator()
      initialStrategy.pages.options = {
        useFileNameForNavigation: true,
      }
      const generator = createProjectGenerator(initialStrategy)

      generator.updatePagesStrategy({
        options: {
          createFolderForEachComponent: true,
          useFileNameForNavigation: false,
        },
      })

      const strategy = generator.getStrategy()

      expect(strategy.pages.options.createFolderForEachComponent).toBe(true)
      expect(strategy.pages.options.useFileNameForNavigation).toBe(false)
    })
  })
})
