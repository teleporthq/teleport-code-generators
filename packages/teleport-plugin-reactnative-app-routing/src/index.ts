import * as types from '@babel/types'
import {
  FileType,
  ChunkType,
  UIDLPageOptions,
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLDependency,
  UIDLRootComponent,
  UIDLRouteDefinitions,
} from '@teleporthq/teleport-types'
import { ASTBuilders, ParsedASTNode } from '@teleporthq/teleport-plugin-common'
import { UIDLUtils } from '@teleporthq/teleport-shared'

interface AppRoutingComponentConfig {
  componentChunkName: string
  importChunkName: string
}

export const createReactAppRoutingComponentPlugin: ComponentPluginFactory<
  AppRoutingComponentConfig
> = (config) => {
  const { importChunkName = 'import-local', componentChunkName = 'app-router-component' } =
    config || {}

  const reactAppRoutingComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies, options } = structure

    if (!uidl?.stateDefinitions?.route) {
      return structure
    }

    const navigatorDependency: UIDLDependency = {
      type: 'library',
      path: 'react-navigaton',
      version: '^4.4.0',
      meta: {
        namedImport: true,
      },
    }

    dependencies.createStackNavigator = navigatorDependency
    dependencies.createAppContainer = navigatorDependency

    const { stateDefinitions = {} } = uidl

    const routes = UIDLUtils.extractRoutes(uidl as UIDLRootComponent)
    const strategy = options.strategy
    const pageDependencyPrefix = options.localDependenciesPrefix || './'
    const navigatorObject: Record<string, { screen: unknown; path: string }> = {}

    routes.forEach((conditionalNode) => {
      const { value } = conditionalNode.content
      const routeKey = value.toString()
      const routeValues = (stateDefinitions.route as UIDLRouteDefinitions).values || []

      const pageDefinition = routeValues.find((route) => route.value === routeKey)

      const defaultOptions: UIDLPageOptions = {}
      const { fileName, componentName, navLink } = pageDefinition.pageOptions || defaultOptions

      /* If pages are exported in their own folder and in custom file names.
         Import statements must then be:

         import Home from '../pages/home/component'

         so the `/component` suffix is computed below.
      */
      const pageStrategyOptions = (strategy && strategy.pages.options) || {}
      const pageComponentSuffix = pageStrategyOptions.createFolderForEachComponent
        ? '/' + (pageStrategyOptions.customComponentFileName || 'index')
        : ''

      dependencies[componentName] = {
        type: 'local',
        path: `${pageDependencyPrefix}${fileName}${pageComponentSuffix}`,
      }

      navigatorObject[routeKey] = {
        screen: new ParsedASTNode(types.identifier(componentName)),
        path: navLink,
      }
    })

    const navigatorOptions = { initialRouteName: 'Home' }
    const routerAST = ASTBuilders.createConstAssignment(
      'MainNavigator',
      // @ts-ignore
      ASTBuilders.createFunctionCall('createStackNavigator', [navigatorObject, navigatorOptions])
    )

    const appDeclaration = ASTBuilders.createConstAssignment(
      'App',
      // @ts-ignore
      ASTBuilders.createFunctionCall('createAppContainer', [types.identifier('MainNavigator')])
    )

    const exportAST = ASTBuilders.createDefaultExport('App')

    structure.chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: componentChunkName,
      content: [routerAST, appDeclaration, exportAST],
      linkAfter: [importChunkName],
    })

    return structure
  }

  return reactAppRoutingComponentPlugin
}

export default createReactAppRoutingComponentPlugin()
