import { ASTBuilders, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  registerReactRouterDeps,
  registerPreactRouterDeps,
  constructRouteJSX,
  createRouteRouterTag,
} from './utils'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'

interface AppRoutingComponentConfig {
  componentChunkName: string
  domRenderChunkName: string
  importChunkName: string
  flavor: 'preact' | 'react'
}

export const createReactAppRoutingPlugin: ComponentPluginFactory<AppRoutingComponentConfig> = (
  config
) => {
  const {
    importChunkName = 'import-local',
    componentChunkName = 'app-router-component',
    domRenderChunkName = 'app-router-export',
    flavor = 'react',
  } = config || {}

  const reactAppRoutingPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies, options } = structure

    if (flavor === 'preact') {
      registerPreactRouterDeps(dependencies)
    } else {
      registerReactRouterDeps(dependencies)
    }

    const { stateDefinitions = {} } = uidl

    const routes = UIDLUtils.extractRoutes(uidl)
    const strategy = options.strategy
    const pageDependencyPrefix = options.localDependenciesPrefix || './'

    const routeJSXDefinitions = routes.map((conditionalNode) => {
      const { value: routeKey } = conditionalNode.content

      const { fileName: pageName, componentName, navLink } = UIDLUtils.extractPageOptions(
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

    const pureComponent = ASTBuilders.createFunctionalComponent(uidl.name, rootRouterTag)

    structure.chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: componentChunkName,
      content: pureComponent,
      linkAfter: [importChunkName],
    })

    if (flavor === 'preact') {
      const exportJSXApp = ASTBuilders.createDefaultExport('App')

      structure.chunks.push({
        type: ChunkType.AST,
        fileType: FileType.JS,
        name: domRenderChunkName,
        content: exportJSXApp,
        linkAfter: [componentChunkName],
      })
    } else {
      const reactDomBind = ASTBuilders.createFunctionCall('ReactDOM.render', [
        ASTBuilders.createSelfClosingJSXTag(uidl.name),
        ASTBuilders.createFunctionCall('document.getElementById', ['app']),
      ])

      structure.chunks.push({
        type: ChunkType.AST,
        fileType: FileType.JS,
        name: domRenderChunkName,
        content: reactDomBind,
        linkAfter: [componentChunkName],
      })
    }

    return structure
  }

  return reactAppRoutingPlugin
}

export default createReactAppRoutingPlugin()
