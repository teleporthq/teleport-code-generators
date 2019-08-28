import * as types from '@babel/types'
import {
  createFunctionCall,
  createDefaultExport,
  createConstAssignment,
} from '@teleporthq/teleport-shared/dist/cjs/builders/ast-builders'
import {
  extractPageMetadata,
  extractRoutes,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'

import { ComponentPluginFactory, ComponentPlugin, UIDLDependency } from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { ParsedASTNode } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-js-utils'

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

    const routes = extractRoutes(uidl)
    const strategy = options.strategy
    const pageDependencyPrefix = options.localDependenciesPrefix || './'
    const navigatorObject = {}

    routes.forEach((conditionalNode) => {
      const { value } = conditionalNode.content
      const routeName = value.toString()

      const { fileName: pageName, componentName, path } = extractPageMetadata(
        stateDefinitions.route,
        routeName
      )

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
        path: `${pageDependencyPrefix}${pageName}${pageComponentSuffix}`,
      }

      navigatorObject[routeName] = {
        screen: new ParsedASTNode(types.identifier(componentName)),
        path,
      }
    })

    const navigatorOptions = { initialRouteName: 'Home' }
    const routerAST = createConstAssignment(
      'MainNavigator',
      createFunctionCall('createStackNavigator', [navigatorObject, navigatorOptions])
    )

    const appDeclaration = createConstAssignment(
      'App',
      createFunctionCall('createAppContainer', [types.identifier('MainNavigator')])
    )

    const exportAST = createDefaultExport('App')

    structure.chunks.push({
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.JS,
      name: componentChunkName,
      content: [routerAST, appDeclaration, exportAST],
      linkAfter: [importChunkName],
    })

    return structure
  }

  return reactAppRoutingComponentPlugin
}

export default createPlugin()
