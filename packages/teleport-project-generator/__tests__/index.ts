import { createProjectGenerator } from '../src'
import { mockMapping, firstStrategy, secondStrategy } from './mocks'

// @ts-ignore
import projectUIDL from '../../../examples/uidl-samples/project.json'

describe('Generic Project Generator', () => {
  describe('with the same component generator for pages and components', () => {
    const generator = createProjectGenerator(firstStrategy)
    const { generator: componentsGenerator } = firstStrategy.components
    const { generatorFunction: routerGenerator } = firstStrategy.router
    const { generatorFunction: entryGenerator } = firstStrategy.entry

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
      await generator.generateProject(projectUIDL)
      expect(componentsGenerator.generateComponent).toBeCalledTimes(8)
      expect(componentsGenerator.generateComponent).toBeCalledWith(
        projectUIDL.components.ExpandableArea,
        {
          assetsPrefix: '/test/static',
          projectRouteDefinition: projectUIDL.root.stateDefinitions.route,
          mapping: {},
          skipValidation: true,
        }
      )
      expect(entryGenerator).toBeCalledTimes(1)
      expect(entryGenerator).toBeCalledWith(projectUIDL, { assetsPrefix: '/test/static' })
      expect(routerGenerator).toBeCalledTimes(1)
      expect(routerGenerator).toBeCalledWith(projectUIDL.root, {
        localDependenciesPrefix: './pages/',
      })
    })
  })

  describe('with the different component generators', () => {
    const generator = createProjectGenerator(secondStrategy)
    const { generator: componentsGenerator } = secondStrategy.components
    const { generator: pagesGenerator } = secondStrategy.pages
    const { generatorFunction: routerGenerator } = secondStrategy.router
    const { generatorFunction: entryGenerator } = secondStrategy.entry

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
      expect(componentsGenerator.generateComponent).toBeCalledTimes(5)
      expect(componentsGenerator.generateComponent).toBeCalledWith(
        projectUIDL.components.ExpandableArea,
        {
          assetsPrefix: '/static',
          projectRouteDefinition: projectUIDL.root.stateDefinitions.route,
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
          localDependenciesPrefix: '../components/',
          assetsPrefix: '/static',
          projectRouteDefinition: projectUIDL.root.stateDefinitions.route,
          mapping: {},
          skipValidation: true,
        }
      )
      expect(entryGenerator).toBeCalledTimes(1)
      expect(entryGenerator).toBeCalledWith(projectUIDL, { assetsPrefix: '/static' })
      expect(routerGenerator).toBeCalledTimes(1)
      expect(routerGenerator).toBeCalledWith(projectUIDL.root, {
        localDependenciesPrefix: './pages/',
      })
    })
  })
})
