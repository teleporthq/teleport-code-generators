import {
  createJSXTag,
  createSelfClosingJSXTag,
  createFunctionCall,
  createFunctionalComponent,
} from '@teleporthq/teleport-shared/lib/builders/ast-builders'
import {
  addChildJSXTag,
  addAttributeToJSXTag,
  addDynamicAttributeToJSXTag,
} from '@teleporthq/teleport-shared/lib/utils/ast-jsx-utils'
import {
  extractPageMetadata,
  extractRoutes,
} from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import { registerRouterDeps } from './utils'
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

      dependencies[componentName] = {
        type: 'local',
        path: `${pageDependencyPrefix}${fileName}`,
      }

      const route = createSelfClosingJSXTag('Route')
      addAttributeToJSXTag(route, 'exact')
      addAttributeToJSXTag(route, 'path', path)
      addDynamicAttributeToJSXTag(route, 'component', componentName)

      return route
    })

    const rootRouterTag = createJSXTag('Router')

    const divContainer = createJSXTag('div')

    addChildJSXTag(rootRouterTag, divContainer)
    routeJSXDefinitions.forEach((route) => addChildJSXTag(divContainer, route))

    const pureComponent = createFunctionalComponent(uidl.name, rootRouterTag)

    structure.chunks.push({
      type: 'js',
      name: componentChunkName,
      content: pureComponent,
      linkAfter: [importChunkName],
    })

    const reactDomBind = createFunctionCall('ReactDOM.render', [
      createSelfClosingJSXTag(uidl.name),
      createFunctionCall('document.getElementById', ['app']),
    ])

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
