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
import { registerReactRouterDeps, registerPreactRouterDeps } from './utils'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'

interface AppRoutingComponentConfig {
  componentChunkName: string
  domRenderChunkName: string
  importChunkName: string
}

const RouteDependencies = {
  react: registerReactRouterDeps,
  preact: registerPreactRouterDeps,
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
    const { useFolderStructure, disableDOMInjection, flavour } = options.meta || {}

    RouteDependencies[flavour](dependencies)

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

      const JSXRoutePrefix = flavour === 'preact' ? componentName : 'Route'

      const route = createSelfClosingJSXTag(JSXRoutePrefix)
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

    if (flavour === 'react') {
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
