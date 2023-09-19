import * as types from '@babel/types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
  UIDLPageOptions,
  UIDLRootComponent,
  UIDLRouteDefinitions,
} from '@teleporthq/teleport-types'
import { join } from 'path'

interface VueRouterConfig {
  codeChunkName: string
  importChunkName: string
}

export const createVueAppRoutingPlugin: ComponentPluginFactory<VueRouterConfig> = (config) => {
  const { codeChunkName = 'vue-router', importChunkName = 'import-local' } = config || {}

  const vueAppRoutingPlugin: ComponentPlugin = async (structure) => {
    const { chunks, uidl, dependencies, options } = structure

    if (!uidl?.stateDefinitions?.route) {
      return structure
    }

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

    const routes = UIDLUtils.extractRoutes(uidl as UIDLRootComponent)
    const routeValues = (uidl.stateDefinitions.route as UIDLRouteDefinitions).values || []
    const pageDependencyPrefix = options.localDependenciesPrefix || './'

    /* If pages are exported in their own folder and in custom file names.
         Import statements must then be:

         import Home from '../pages/home/component'

         so the `/component` suffix is computed below.
      */
    const pageStrategyOptions = (options.strategy && options.strategy.pages.options) || {}
    const pageComponentSuffix = pageStrategyOptions.createFolderForEachComponent ? '/index' : ''

    const routesAST = routeValues
      .sort((routeA) => {
        if (routeA?.pageOptions?.fallback) {
          return 1
        }
      })
      .map((route) => {
        const page = routes.find((routeNode) => routeNode.content.value.toString() === route.value)
        if (!page) {
          throw new Error(`Failed to match route ${route.value} with a page`)
        }

        const pageKey = page.content.value.toString()

        const defaultOptions: UIDLPageOptions = {}
        const { componentName, navLink, fileName, fallback } = route.pageOptions || defaultOptions

        /*
        Now, navLink is being used to create a folder strucutre.
        So, it is important to append the same when generating the path
      */

        dependencies[componentName] = {
          type: 'local',
          path: `${pageDependencyPrefix}${join(
            ...navLink.split('/')?.slice(0, -1),
            fileName,
            pageComponentSuffix
          )}`,
        }

        const routeObject = types.objectExpression([
          types.objectProperty(types.identifier('name'), types.stringLiteral(pageKey)),
          types.objectProperty(types.identifier('path'), types.stringLiteral(navLink)),
          types.objectProperty(types.identifier('component'), types.identifier(componentName)),
        ])

        if (fallback) {
          routeObject.properties.push(
            types.objectProperty(types.identifier('fallback'), types.booleanLiteral(true))
          )
        }

        return routeObject
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
