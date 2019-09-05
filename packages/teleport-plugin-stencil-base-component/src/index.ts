import { createClassDeclaration } from './utils'
import { createComponentDecorator } from '@teleporthq/teleport-shared/dist/cjs/utils/ast-jsx-utils'
import createJSXSyntax from '@teleporthq/teleport-shared/dist/cjs/node-handlers/node-to-jsx'
import { JSXGenerationOptions } from '@teleporthq/teleport-shared/dist/cjs/node-handlers/node-to-jsx/types'
import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'

import {
  DEFAULT_COMPONENT_CHUNK_NAME,
  DEFAULT_IMPORT_CHUNK_NAME,
  DEFAULT_COMPONENT_DECORATOR_CHUNK_NAME,
  STENCIL_CORE_DEPENDENCY,
} from './constants'
import { CHUNK_TYPE, FILE_TYPE } from '@teleporthq/teleport-shared/dist/cjs/constants'
import { camelCaseToDashCase } from '@teleporthq/teleport-shared/dist/cjs/utils/string-utils'

interface StencilPluginConfig {
  componentChunkName: string
  componentDecoratorChunkName: string
  importChunkName: string
}

export const createPlugin: ComponentPluginFactory<StencilPluginConfig> = (config) => {
  const {
    componentChunkName = DEFAULT_COMPONENT_CHUNK_NAME,
    componentDecoratorChunkName = DEFAULT_COMPONENT_DECORATOR_CHUNK_NAME,
    importChunkName = DEFAULT_IMPORT_CHUNK_NAME,
  } = config || {}

  const stencilComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, dependencies } = structure
    const { stateDefinitions = {}, propDefinitions = {} } = uidl

    dependencies.Component = STENCIL_CORE_DEPENDENCY
    dependencies.h = STENCIL_CORE_DEPENDENCY

    if (Object.keys(propDefinitions).length > 0) {
      dependencies.Prop = STENCIL_CORE_DEPENDENCY
    }

    if (Object.keys(stateDefinitions).length > 0) {
      dependencies.State = STENCIL_CORE_DEPENDENCY
    }

    // We will keep a flat mapping object from each component identifier (from the UIDL) to its correspoding JSX AST Tag
    // This will help us inject style or classes at a later stage in the pipeline, upon traversing the UIDL
    // The structure will be populated as the AST is being created
    const nodesLookup = {}
    const jsxParams = {
      propDefinitions,
      stateDefinitions,
      nodesLookup,
      dependencies,
    }

    const jsxOptions: JSXGenerationOptions = {
      dynamicReferencePrefixMap: {
        prop: 'this',
        state: 'this',
        local: '',
      },
      dependencyHandling: 'ignore',
      stateHandling: 'mutation',
      slotHandling: 'native',
      customElementTag: (name: string) => `app-${camelCaseToDashCase(name)}`,
    }

    const jsxTagStructure = createJSXSyntax(uidl.node, jsxParams, jsxOptions)
    const exportAST = createClassDeclaration(
      uidl.name,
      propDefinitions,
      stateDefinitions,
      jsxTagStructure
    )

    const params = {
      tag: `app-${camelCaseToDashCase(uidl.name)}`,
      shadow: true,
    }

    const decoratorAST = createComponentDecorator(params)

    structure.chunks.push({
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.TSX,
      name: componentDecoratorChunkName,
      meta: {
        nodesLookup,
      },
      content: decoratorAST,
      linkAfter: [importChunkName],
    })

    structure.chunks.push({
      type: CHUNK_TYPE.AST,
      fileType: FILE_TYPE.TSX,
      name: componentChunkName,
      meta: {
        nodesLookup,
        dynamicRefPrefix: jsxOptions.dynamicReferencePrefixMap,
      },
      content: exportAST,
      linkAfter: [importChunkName],
    })

    return structure
  }

  return stencilComponentPlugin
}

export default createPlugin()
