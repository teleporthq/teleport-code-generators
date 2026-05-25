import { Constants, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  createJSXSyntax,
  JSXGenerationOptions,
  ASTBuilders,
  ASTUtils,
  JSXGenerationParams,
} from '@teleporthq/teleport-plugin-common'

import {
  ComponentPluginFactory,
  ComponentPlugin,
  ChunkType,
  FileType,
  UIDLElementNode,
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
    const { uidl, dependencies } = structure
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
    const jsxParams: JSXGenerationParams = {
      propDefinitions,
      stateDefinitions,
      globalStateDefinitions: structure.options?.globalStateDefinitions || {},
      nodesLookup,
      dependencies,
      windowImports,
      localeReferences: [],
      globalReferences: [],
      globalStateReferences: [],
      hoistedConstants: [],
      detailsPageExposeAsName: uidl.outputOptions?.initialPropsData?.exposeAs?.name,
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
      domHTMLInjection: (content: string) => ASTBuilders.createDOMInjectionNode(content),
      detailsPageExposeAsName: uidl.outputOptions?.initialPropsData?.exposeAs?.name,
    }

    /*
      We need to generate jsx structure of every node that is defined in the UIDL.
      If we use these nodes in the later stage of the code-generation depends on the usage of these nodes.
    */
    for (const propKey of Object.keys(propDefinitions)) {
      const prop = propDefinitions[propKey]
      if (prop.type === 'element' && typeof prop.defaultValue === 'object') {
        createJSXSyntax(prop.defaultValue as UIDLElementNode, jsxParams, jsxOptions)
      }
    }

    const objectStateGlobalRefs = ASTUtils.collectGlobalReferencesFromObjectStates(stateDefinitions)
    objectStateGlobalRefs.forEach((ref) => {
      jsxParams.globalReferences.push(ref as any)
    })

    const objectStateGlobalStateRefs =
      ASTUtils.collectGlobalStateReferencesFromObjectStates(stateDefinitions)
    objectStateGlobalStateRefs.forEach((ref) => {
      const definitions = structure.options?.globalStateDefinitions || {}
      let name = ref.id
      for (const def of Object.values(definitions)) {
        if (def.id === ref.id) {
          name = def.name
          break
        }
      }
      jsxParams.globalStateReferences.push({ id: ref.id, name })
    })

    const jsxTagStructure = createJSXSyntax(uidl.node, jsxParams, jsxOptions)

    // Chart.js v3+ requires explicit registration of scales, elements, and plugins.
    // When react-chartjs-2 is used, we need to add the registration code.
    const usedChartComponents: string[] = []
    Object.keys(dependencies).forEach((dep) => {
      if (dependencies[dep]?.path === 'react-chartjs-2') {
        usedChartComponents.push(dep)
      }
    })

    if (usedChartComponents.length > 0) {
      const chartRegistrations = [
        'CategoryScale',
        'LinearScale',
        'PointElement',
        'LineElement',
        'BarElement',
        'ArcElement',
        'Title',
        'Tooltip',
        'Legend',
        'Filler',
      ]
      dependencies.ChartJS = {
        type: 'package',
        path: 'chart.js',
        version: '^4.0.0',
        meta: {
          namedImport: true,
          originalName: 'Chart',
        },
      }
      chartRegistrations.forEach((reg) => {
        dependencies[reg] = {
          type: 'package',
          path: 'chart.js',
          version: '^4.0.0',
          meta: {
            namedImport: true,
          },
        }
      })
    }

    const componentName = UIDLUtils.getComponentClassName(uidl)
    const pureComponent = ASTUtils.createPureComponent(
      componentName,
      stateDefinitions,
      jsxTagStructure,
      windowImports,
      jsxOptions.dynamicReferencePrefixMap
    )

    // Add Chart.js registration call after imports
    if (usedChartComponents.length > 0) {
      const chartRegistrations = [
        'CategoryScale',
        'LinearScale',
        'PointElement',
        'LineElement',
        'BarElement',
        'ArcElement',
        'Title',
        'Tooltip',
        'Legend',
        'Filler',
      ]
      const registerCall = types.expressionStatement(
        types.callExpression(
          types.memberExpression(types.identifier('ChartJS'), types.identifier('register')),
          chartRegistrations.map((r) => types.identifier(r))
        )
      )
      structure.chunks.push({
        type: ChunkType.AST,
        fileType: FileType.JS,
        name: 'chart-registration',
        content: registerCall,
        linkAfter: [importChunkName],
      })
    }

    // Hoist static object attributes as module-level constants to prevent
    // unnecessary re-renders (new object references on each render)
    if (jsxParams.hoistedConstants.length > 0) {
      const declarations = jsxParams.hoistedConstants.map((c) =>
        types.variableDeclaration('const', [
          types.variableDeclarator(types.identifier(c.name), c.expression),
        ])
      )
      declarations.forEach((decl, i) => {
        structure.chunks.push({
          type: ChunkType.AST,
          fileType: FileType.JS,
          name: `hoisted-constant-${i}`,
          content: decl,
          linkAfter: [importChunkName],
        })
      })
    }

    if (dependencies?.useRouter) {
      const componentBody = (
        (pureComponent.declarations[0] as types.VariableDeclarator)
          .init as types.ArrowFunctionExpression
      ).body as types.BlockStatement

      const routerAlreadyDeclared = componentBody.body.some(
        (statement) =>
          statement.type === 'VariableDeclaration' &&
          statement.declarations.some(
            (declaration) =>
              declaration.id.type === 'Identifier' && declaration.id.name === 'router'
          )
      )

      if (!routerAlreadyDeclared) {
        const routerAST = types.variableDeclaration('const', [
          types.variableDeclarator(
            types.identifier('router'),
            types.callExpression(types.identifier('useRouter'), [])
          ),
        ])
        componentBody.body.unshift(routerAST)
      }
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
        localeReferences: jsxParams.localeReferences,
        globalReferences: jsxParams.globalReferences,
        globalStateReferences: jsxParams.globalStateReferences,
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
