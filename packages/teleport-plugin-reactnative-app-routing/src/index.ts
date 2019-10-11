import * as types from '@babel/types'
import {
  FileType,
  ChunkType,
  UIDLPageOptions,
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLDependency,
} from '@teleporthq/teleport-types'
import { UIDLUtils, ASTBuilders, ParsedASTNode } from '@teleporthq/teleport-shared'

interface AppRoutingComponentConfig {
  componentChunkName: string
  importChunkName: string
}

export const createPlugin: ComponentPluginFactory<AppRoutingComponentConfig> = (config) => {
  const { importChunkName = 'import-local', componentChunkName = 'app-router-component' } =
    config || {}

  const reactAppRoutingComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies, options } = structure

    const navigatorDependency: UIDLDependency = {
      type: 'library',
      path: 'react-navigator',
      meta: {
        namedImport: true,
      },
    }

    dependencies.createStackNavigator = navigatorDependency
    dependencies.createAppContainer = navigatorDependency

    const { stateDefinitions = {} } = uidl

    const routes = UIDLUtils.extractRoutes(uidl)
    const strategy = options.strategy
    const pageDependencyPrefix = options.localDependenciesPrefix || './'
    const navigatorObject: Record<string, { screen: unknown; path: string }> = {}

    routes.forEach((conditionalNode) => {
      const { value } = conditionalNode.content
      const routeKey = value.toString()
      const routeValues = stateDefinitions.route.values || []

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
      ASTBuilders.createFunctionCall('createStackNavigator', [navigatorObject, navigatorOptions])
    )

    const appDeclaration = ASTBuilders.createConstAssignment(
      'App',
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

export default createPlugin()
