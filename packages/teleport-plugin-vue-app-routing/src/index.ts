import * as types from '@babel/types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
  UIDLPageOptions,
} from '@teleporthq/teleport-types'

interface VueRouterConfig {
  codeChunkName: string
  importChunkName: string
}

export const createVueAppRoutingPlugin: ComponentPluginFactory<VueRouterConfig> = (config) => {
  const { codeChunkName = 'vue-router', importChunkName = 'import-local' } = config || {}

  const vueAppRoutingPlugin: ComponentPlugin = async (structure) => {
    const { chunks, uidl, dependencies, options } = structure

    dependencies.Vue = {
      type: 'library',
      path: 'vue',
      version: '^2.6.7',
    }
    dependencies.Router = {
      type: 'library',
      path: 'vue-router',
      version: '^3.0.2',
    }
    dependencies.Meta = {
      type: 'library',
      path: 'vue-meta',
      version: '^2.2.1',
    }

    const routerDeclaration = types.expressionStatement(
      types.callExpression(types.identifier('Vue.use'), [types.identifier('Router')])
    )

    const metaDeclaration = types.expressionStatement(
      types.callExpression(types.identifier('Vue.use'), [types.identifier('Meta')])
    )

    const routes = UIDLUtils.extractRoutes(uidl)
    const routeValues = uidl.stateDefinitions.route.values || []
    const pageDependencyPrefix = options.localDependenciesPrefix || './'

    /* If pages are exported in their own folder and in custom file names.
         Import statements must then be:

         import Home from '../pages/home/component'

         so the `/component` suffix is computed below.
      */
    const pageStrategyOptions = (options.strategy && options.strategy.pages.options) || {}
    const pageComponentSuffix = pageStrategyOptions.createFolderForEachComponent ? '/index' : ''

    const routesAST = routes.map((routeNode) => {
      const pageKey = routeNode.content.value.toString()

      const pageDefinition = routeValues.find((route) => route.value === pageKey)
      const defaultOptions: UIDLPageOptions = {}
      const { componentName, navLink, fileName } = pageDefinition.pageOptions || defaultOptions

      dependencies[componentName] = {
        type: 'local',
        path: `${pageDependencyPrefix}${fileName}${pageComponentSuffix}`,
      }

      return types.objectExpression([
        types.objectProperty(types.identifier('name'), types.stringLiteral(pageKey)),
        types.objectProperty(types.identifier('path'), types.stringLiteral(navLink)),
        types.objectProperty(types.identifier('component'), types.identifier(componentName)),
      ])
    })

    const exportStatement = types.exportDefaultDeclaration(
      types.newExpression(types.identifier('Router'), [
        types.objectExpression([
          types.objectProperty(types.identifier('mode'), types.stringLiteral('history')),
          types.objectProperty(types.identifier('routes'), types.arrayExpression(routesAST)),
        ]),
      ])
    )

    chunks.push({
      name: codeChunkName,
      linkAfter: [importChunkName],
      type: ChunkType.AST,
      fileType: FileType.JS,
      content: [routerDeclaration, metaDeclaration, exportStatement],
    })

    return structure
  }

  return vueAppRoutingPlugin
}

export default createVueAppRoutingPlugin()
