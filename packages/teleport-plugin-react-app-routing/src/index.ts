import { UIDLUtils } from '@teleporthq/teleport-shared'
import { ASTBuilders } from '@teleporthq/teleport-plugin-common'
import { registerReactRouterDeps, constructRouteJSX, createRouteRouterTag } from './utils'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
  UIDLPageOptions,
  UIDLRootComponent,
  UIDLRouteDefinitions,
} from '@teleporthq/teleport-types'
import { join } from 'path'

interface AppRoutingComponentConfig {
  componentChunkName: string
  domRenderChunkName: string
  importChunkName: string
}

export const createReactAppRoutingPlugin: ComponentPluginFactory<AppRoutingComponentConfig> = (
  config
) => {
  const {
    importChunkName = 'import-local',
    componentChunkName = 'app-router-component',
    domRenderChunkName = 'app-router-export',
  } = config || {}

  const reactAppRoutingPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies, options } = structure

    if (!uidl?.stateDefinitions?.route) {
      return structure
    }

    registerReactRouterDeps(dependencies)

    const { stateDefinitions = {} } = uidl

    const routes = UIDLUtils.extractRoutes(uidl as UIDLRootComponent)
    const strategy = options.strategy
    const pageDependencyPrefix = options.localDependenciesPrefix || './'

    const routeJSXDefinitions = routes.map((conditionalNode) => {
      const { value: routeKey } = conditionalNode.content
      const routeValues = (stateDefinitions.route as UIDLRouteDefinitions).values || []
      const routeDefinition = routeValues.find((route) => route.value === routeKey)
      const defaultOptions: UIDLPageOptions = {}
      const { fileName, componentName, navLink, fallback } =
        routeDefinition.pageOptions || defaultOptions

      /* If pages are exported in their own folder and in custom file names.
         Import statements must then be:

         import Home from '../pages/home/component'

         so the `/component` suffix is computed below.
      */
      const pageStrategyOptions = (strategy && strategy.pages.options) || {}
      const pageComponentSuffix = pageStrategyOptions.createFolderForEachComponent ? '/index' : ''

      /*
        Now, navLink is being used to create a folder strucutre.
        So, it is important to append the same when generating the path
      */

      dependencies[componentName] = {
        type: 'local',
        path: `${pageDependencyPrefix}${join(
          ...navLink.split('/')?.slice(0, -1),
          fileName,
          pageComponentSuffix
        )}`,
      }

      return constructRouteJSX(componentName, navLink, fallback)
    })

    const rootRouterTag = createRouteRouterTag(routeJSXDefinitions)

    const pureComponent = ASTBuilders.createFunctionalComponent(uidl.name, rootRouterTag)

    structure.chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: componentChunkName,
      content: pureComponent,
      linkAfter: [importChunkName],
    })

    // @ts-ignore
    const reactDomBind = ASTBuilders.createFunctionCall('ReactDOM.render', [
      ASTBuilders.createSelfClosingJSXTag(uidl.name),
      // @ts-ignore
      ASTBuilders.createFunctionCall('document.getElementById', ['app']),
    ])

    structure.chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: domRenderChunkName,
      content: reactDomBind,
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return reactAppRoutingPlugin
}

export default createReactAppRoutingPlugin()
