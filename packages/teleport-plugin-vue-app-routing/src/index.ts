import * as t from '@babel/types'
import {
  extractPageMetadata,
  extractRoutes,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

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

    const declaration = t.expressionStatement(
      t.callExpression(t.identifier('Vue.use'), [t.identifier('Router')])
    )

    const routes = extractRoutes(uidl)
    const routeDefinitions = uidl.stateDefinitions.route
    const pageDependencyPrefix = options.localDependenciesPrefix || './'

    const routesAST = routes.map((routeNode) => {
      const pageKey = routeNode.content.value.toString()
      const { fileName, componentName, path } = extractPageMetadata(routeDefinitions, pageKey)

      dependencies[componentName] = { type: 'local', path: `${pageDependencyPrefix}${fileName}` }

      return t.objectExpression([
        t.objectProperty(t.identifier('name'), t.stringLiteral(pageKey)),
        t.objectProperty(t.identifier('path'), t.stringLiteral(path)),
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
      type: CHUNK_TYPE.AST,
      fileId: FILE_TYPE.JS,
      content: [declaration, exportStatement],
    })

    return structure
  }

  return vueRouterComponentPlugin
}

export default createPlugin()
