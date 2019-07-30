import {
  createSelfClosingJSXTag,
  createFunctionCall,
  createFunctionalComponent,
  createDefaultExport,
} from '@teleporthq/teleport-shared/dist/cjs/builders/ast-builders'
import {
  extractPageMetadata,
  extractRoutes,
} from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'
import {
  registerReactRouterDeps,
  registerPreactRouterDeps,
  constructRouteJSX,
  createRouteRouterTag,
} from './utils'
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
    const { createFolderForEachComponent, flavour } = options.meta || {
      createFolderForEachComponent: false,
    }

    if (flavour === 'preact') {
      registerPreactRouterDeps(dependencies)
    } else {
      registerReactRouterDeps(dependencies)
    }

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

      return constructRouteJSX(flavour, componentName, path)
    })

    const rootRouterTag = createRouteRouterTag(flavour, routeJSXDefinitions)

    const pureComponent = createFunctionalComponent(uidl.name, rootRouterTag)

    structure.chunks.push({
      type: CHUNK_TYPE.AST,
      fileId: FILE_TYPE.JS,
      name: componentChunkName,
      content: pureComponent,
      linkAfter: [importChunkName],
    })

    if (flavour === 'preact') {
      const exportJSXApp = createDefaultExport('App')

      structure.chunks.push({
        type: 'js',
        name: domRenderChunkName,
        content: exportJSXApp,
        linkAfter: [componentChunkName],
      })
    } else {
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
