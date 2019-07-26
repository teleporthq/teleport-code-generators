import {
  createJSXTag,
  createSelfClosingJSXTag,
  createFunctionCall,
  createFunctionalComponent,
} from '@teleporthq/teleport-shared/dist/cjs/builders/ast-builders'
import {
  addChildJSXTag,
  addAttributeToJSXTag,
  addDynamicAttributeToJSXTag,
} from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import {
  extractPageMetadata,
  extractRoutes,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import { dashCaseToCamelCase } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'
import { registerRouterDeps } from './utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

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
    // @ts-ignore-next-line
    const { useFolderStructure, disableDOMInjection } = options.meta || {}

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
        path: useFolderStructure
          ? `${pageDependencyPrefix}${dashCaseToCamelCase(fileName)}/${fileName}`
          : `${pageDependencyPrefix}${fileName}`,
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
      type: CHUNK_TYPE.AST,
      fileId: FILE_TYPE.JS,
      name: componentChunkName,
      content: pureComponent,
      linkAfter: [importChunkName],
    })

    if (!disableDOMInjection) {
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
    }

    return structure
  }

  return reactAppRoutingComponentPlugin
}

export default createPlugin()
