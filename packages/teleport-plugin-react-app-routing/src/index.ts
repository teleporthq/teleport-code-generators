import * as t from '@babel/types'

import { generateASTDefinitionForJSXTag } from '@teleporthq/teleport-shared/lib/utils/ast-jsx-utils'
import {
  extractPageMetadata,
  extractRoutes,
} from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import { registerRouterDeps, makePureComponent } from './utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'

interface AppRoutingComponentConfig {
  componentChunkName: string
  domRenderChunkName: string
  importChunkName: string
}

export const createPlugin: ComponentPluginFactory<AppRoutingComponentConfig> = (config) => {
  const {
    importChunkName = 'import-local',
    componentChunkName = 'app-router-component',
    domRenderChunkName = 'app-router-export',
  } = config || {}

  const reactAppRoutingComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies, options } = structure

    registerRouterDeps(dependencies)

    const { stateDefinitions = {} } = uidl

    const routes = extractRoutes(uidl)
    const pageDependencyPrefix = options.localDependenciesPrefix || './'

    const routeJSXDefinitions = routes.map((conditionalNode) => {
      const { value: routeKey } = conditionalNode.content

      const { fileName, componentName, path } = extractPageMetadata(
        stateDefinitions.route,
        routeKey.toString()
      )
      const route = generateASTDefinitionForJSXTag('Route')

      dependencies[componentName] = {
        type: 'local',
        path: `${pageDependencyPrefix}${fileName}`,
      }

      route.openingElement.attributes.push(
        t.jsxAttribute(t.jsxIdentifier('exact')),
        t.jsxAttribute(t.jsxIdentifier('path'), t.stringLiteral(path)),
        t.jsxAttribute(
          t.jsxIdentifier('component'),
          t.jsxExpressionContainer(t.identifier(componentName))
        )
      )

      return route
    })

    const rootRouterTag = generateASTDefinitionForJSXTag('Router')

    const divContainer = generateASTDefinitionForJSXTag('div')

    rootRouterTag.children.push(divContainer)

    routeJSXDefinitions.forEach((route) => {
      if (route) {
        divContainer.children.push(route)
      }
    })

    const pureComponent = makePureComponent({
      name: uidl.name,
      jsxTagTree: rootRouterTag,
    })

    structure.chunks.push({
      type: 'js',
      name: componentChunkName,
      content: pureComponent,
      linkAfter: [importChunkName],
    })

    // makes ReactDOM.render(AppName, document.getElementById('root'));
    const reactDomBind = t.expressionStatement(
      t.callExpression(t.memberExpression(t.identifier('ReactDOM'), t.identifier('render')), [
        generateASTDefinitionForJSXTag(uidl.name),
        t.callExpression(
          t.memberExpression(t.identifier('document'), t.identifier('getElementById')),
          [t.stringLiteral('app')]
        ),
      ])
    )

    structure.chunks.push({
      type: 'js',
      name: domRenderChunkName,
      content: reactDomBind,
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return reactAppRoutingComponentPlugin
}

export default createPlugin()
