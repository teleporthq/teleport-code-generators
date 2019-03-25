import * as t from '@babel/types'
import { extractPageMetadata } from '../../shared/utils/uidl-utils'

interface VueRouterConfig {
  codeChunkName: string
  importChunkName: string
}

export const createPlugin: ComponentPluginFactory<VueRouterConfig> = (config) => {
  const { codeChunkName = 'vue-router', importChunkName = 'import-local' } = config || {}

  const vueRouterComponentPlugin: ComponentPlugin = async (structure) => {
    const { chunks, uidl, dependencies } = structure

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

    const { stateDefinitions = {} } = uidl
    const { states: pages = [] } = uidl.content
    const { router: routerDefinitions } = stateDefinitions

    const routesAST = pages.map((page) => {
      const pageKey = page.value as string
      const { fileName, componentName, path } = extractPageMetadata(routerDefinitions, pageKey)

      dependencies[componentName] = { type: 'local', path: `./views/${fileName}` }

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
      type: 'js',
      content: [declaration, exportStatement],
    })

    return structure
  }

  return vueRouterComponentPlugin
}

export default createPlugin()
