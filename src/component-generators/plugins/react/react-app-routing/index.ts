import * as t from '@babel/types'

import { generateASTDefinitionForJSXTag } from '../../../utils/jsx-ast'
import { extractPageMetadata } from '../../../utils/uidl-utils'
import { registerRouterDeps, makePureComponent } from './utils'
import { ComponentPlugin, ComponentPluginFactory } from '../../../types'

interface AppRoutingComponentConfig {
  componentChunkName: string
  domRenderChunkName: string
  importChunkName: string
}

export const createPlugin: ComponentPluginFactory<AppRoutingComponentConfig> = (config) => {
  const {
    importChunkName = 'imports',
    componentChunkName = 'app-routing-component',
    domRenderChunkName = 'app-routing-bind-to-dom',
  } = config || {}

  const reactAppRoutingComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies } = structure

    registerRouterDeps(dependencies)

    const { content, stateDefinitions = {} } = uidl
    const { states: pages = [] } = uidl.content
    const { router: routerDefinitions } = stateDefinitions

    const routeJSXDefinitions = pages.map((page) => {
      const { value: pageKey } = page

      if (typeof pageKey !== 'string' || typeof content === 'string') {
        console.warn('Route not correctly specified. Value should be a string when defining routes')
        return null
      }

      const { fileName, componentName, path } = extractPageMetadata(routerDefinitions, pageKey)
      const route = generateASTDefinitionForJSXTag('Route')

      dependencies[componentName] = {
        type: 'local',
        path: `./pages/${fileName}`,
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
      linker: {
        after: [importChunkName],
      },
      content: pureComponent,
    })

    // makes ReactDOM.render(AppName, document.getElementById('root'));
    const reactDomBind = t.expressionStatement(
      t.callExpression(t.memberExpression(t.identifier('ReactDOM'), t.identifier('render')), [
        generateASTDefinitionForJSXTag(uidl.name),
        t.callExpression(
          t.memberExpression(t.identifier('document'), t.identifier('getElementById')),
          [t.stringLiteral('root')]
        ),
      ])
    )

    structure.chunks.push({
      type: 'js',
      name: domRenderChunkName,
      linker: {
        after: [componentChunkName],
      },
      content: reactDomBind,
    })

    return structure
  }

  return reactAppRoutingComponentPlugin
}
