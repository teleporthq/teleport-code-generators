import {
  createSelfClosingJSXTag,
  createFunctionCall,
  createFunctionalComponent,
  createDefaultExport,
} from '@teleporthq/teleport-shared/dist/cjs/builders/ast-builders'
import {
  extractPageOptions,
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
  flavor: 'preact' | 'react'
}

export const createPlugin: ComponentPluginFactory<AppRoutingComponentConfig> = (config) => {
  const {
    importChunkName = 'import-local',
    componentChunkName = 'app-router-component',
    domRenderChunkName = 'app-router-export',
    flavor = 'react',
  } = config || {}

  const reactAppRoutingComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies, options } = structure

    if (flavor === 'preact') {
      registerPreactRouterDeps(dependencies)
    } else {
      registerReactRouterDeps(dependencies)
    }

    const { stateDefinitions = {} } = uidl

    const routes = extractRoutes(uidl)
    const strategy = options.strategy
    const pageDependencyPrefix = options.localDependenciesPrefix || './'

    const routeJSXDefinitions = routes.map((conditionalNode) => {
      const { value: routeKey } = conditionalNode.content

      const { fileName: pageName, componentName, navLink } = extractPageOptions(
        stateDefinitions.route,
        routeKey.toString()
      )

      /* If pages are exported in their own folder and in custom file names.
         Import statements must then be:

         import Home from '../pages/home/component'

         so the `/component` suffix is computed below.
      */
      const pageStrategyOptions = (strategy && strategy.pages.options) || {}
      const pageComponentSuffix = pageStrategyOptions.createFolderForEachComponent
        ? '/' + (pageStrategyOptions.customComponentFileName || 'index')
        : ''

      dependencies[componentName] = {
        type: 'local',
        path: `${pageDependencyPrefix}${pageName}${pageComponentSuffix}`,
      }

      return constructRouteJSX(flavor, componentName, navLink)
    })

    const rootRouterTag = createRouteRouterTag(flavor, routeJSXDefinitions)

    const pureComponent = createFunctionalComponent(uidl.name, rootRouterTag)

    structure.chunks.push({
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.JS,
      name: componentChunkName,
      content: pureComponent,
      linkAfter: [importChunkName],
    })

    if (flavor === 'preact') {
      const exportJSXApp = createDefaultExport('App')

      structure.chunks.push({
        type: CHUNK_TYPE.AST,
        fileType: FILE_TYPE.JS,
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
        type: CHUNK_TYPE.AST,
        fileType: FILE_TYPE.JS,
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
