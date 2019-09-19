import * as t from '@babel/types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'

interface VueRouterConfig {
  codeChunkName: string
  importChunkName: string
}

export const createPlugin: ComponentPluginFactory<VueRouterConfig> = (config) => {
  const { codeChunkName = 'vue-router', importChunkName = 'import-local' } = config || {}

  const vueRouterComponentPlugin: ComponentPlugin = async (structure) => {
    const { chunks, uidl, dependencies, options } = structure

    dependencies.Vue = {
      type: 'library',
      path: 'vue',
    }
    dependencies.Router = {
      type: 'library',
      path: 'vue-router',
    }
    dependencies.Meta = {
      type: 'library',
      path: 'vue-meta',
    }

    const routerDeclaration = t.expressionStatement(
      t.callExpression(t.identifier('Vue.use'), [t.identifier('Router')])
    )

    const metaDeclaration = t.expressionStatement(
      t.callExpression(t.identifier('Vue.use'), [t.identifier('Meta')])
    )

    const routes = UIDLUtils.extractRoutes(uidl)
    const routeDefinitions = uidl.stateDefinitions.route
    const pageDependencyPrefix = options.localDependenciesPrefix || './'

    /* If pages are exported in their own folder and in custom file names.
         Import statements must then be:

         import Home from '../pages/home/component'

         so the `/component` suffix is computed below.
      */
    const pageStrategyOptions = (options.strategy && options.strategy.pages.options) || {}
    const pageComponentSuffix = pageStrategyOptions.createFolderForEachComponent
      ? '/' + (pageStrategyOptions.customComponentFileName || 'index')
      : ''

    const routesAST = routes.map((routeNode) => {
      const pageKey = routeNode.content.value.toString()
      const { fileName, componentName, navLink } = UIDLUtils.extractPageOptions(
        routeDefinitions,
        pageKey
      )

      dependencies[componentName] = {
        type: 'local',
        path: `${pageDependencyPrefix}${fileName}${pageComponentSuffix}`,
      }

      return t.objectExpression([
        t.objectProperty(t.identifier('name'), t.stringLiteral(pageKey)),
        t.objectProperty(t.identifier('path'), t.stringLiteral(navLink)),
        t.objectProperty(t.identifier('component'), t.identifier(componentName)),
      ])
    })

    const exportStatement = t.exportDefaultDeclaration(
      t.newExpression(t.identifier('Router'), [
        t.objectExpression([
          t.objectProperty(t.identifier('mode'), t.stringLiteral('history')),
          t.objectProperty(t.identifier('routes'), t.arrayExpression(routesAST)),
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

  return vueRouterComponentPlugin
}

export default createPlugin()
