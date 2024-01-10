import { createDOMInjectionNode } from './utils'
import { Constants, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  createJSXSyntax,
  JSXGenerationOptions,
  ASTBuilders,
  ASTUtils,
} from '@teleporthq/teleport-plugin-common'

import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'

import {
  DEFAULT_COMPONENT_CHUNK_NAME,
  DEFAULT_EXPORT_CHUNK_NAME,
  DEFAULT_IMPORT_CHUNK_NAME,
  REACT_LIBRARY_DEPENDENCY,
} from './constants'

interface ReactPluginConfig {
  componentChunkName: string
  exportChunkName: string
  importChunkName: string
}

export const createReactComponentPlugin: ComponentPluginFactory<ReactPluginConfig> = (config) => {
  const {
    componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME,
    exportChunkName = DEFAULT_EXPORT_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
  } = config || {}

  const reactComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies, options } = structure
    const { projectResources } = options
    const { stateDefinitions = {}, propDefinitions = {} } = uidl

    dependencies.React = REACT_LIBRARY_DEPENDENCY

    if (Object.keys(stateDefinitions).length > 0) {
      dependencies.useState = Constants.USE_STATE_DEPENDENCY
    }

    // We will keep a flat mapping object from each component identifier (from the UIDL) to its correspoding JSX AST Tag
    // This will help us inject style or classes at a later stage in the pipeline, upon traversing the UIDL
    // The structure will be populated as the AST is being created
    const nodesLookup = {}
    const windowImports: Record<string, types.ExpressionStatement> = {}
    const jsxParams = {
      propDefinitions,
      stateDefinitions,
      nodesLookup,
      dependencies,
      projectResources,
      windowImports,
    }

    const jsxOptions: JSXGenerationOptions = {
      dynamicReferencePrefixMap: {
        prop: 'props',
        state: '',
        local: '',
      },
      dependencyHandling: 'import',
      stateHandling: 'hooks',
      slotHandling: 'props',
      domHTMLInjection: (content: string) => createDOMInjectionNode(content),
    }

    const jsxTagStructure = createJSXSyntax(uidl.node, jsxParams, jsxOptions)

    const componentName = UIDLUtils.getComponentClassName(uidl)
    const pureComponent = ASTUtils.createPureComponent(
      componentName,
      stateDefinitions,
      jsxTagStructure,
      windowImports
    )

    if (dependencies?.useRouter) {
      const routerAST = types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier('router'),
          types.callExpression(types.identifier('useRouter'), [])
        ),
      ])
      const componentBody = (
        (pureComponent.declarations[0] as types.VariableDeclarator)
          .init as types.ArrowFunctionExpression
      ).body as types.BlockStatement
      componentBody.body.unshift(routerAST)
    }

    if (Object.keys(windowImports).length) {
      dependencies.useEffect = Constants.USE_STATE_DEPENDENCY
    }

    structure.chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: componentChunkName,
      meta: {
        nodesLookup,
        dynamicRefPrefix: jsxOptions.dynamicReferencePrefixMap,
      },
      content: pureComponent,
      linkAfter: [importChunkName],
    })

    structure.chunks.push({
      type: ChunkType.AST,
      fileType: FileType.JS,
      name: exportChunkName,
      content: ASTBuilders.createDefaultExport(componentName),
      linkAfter: [componentChunkName],
    })

    return structure
  }

  return reactComponentPlugin
}

export default createReactComponentPlugin()
