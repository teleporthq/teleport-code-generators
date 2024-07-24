import { generateVueComponentJS, extractStateObject } from './utils'
import {
  ComponentPluginFactory,
  ComponentPlugin,
  FileType,
  ChunkType,
  UIDLEventHandlerStatement,
  UIDLElementNode,
} from '@teleporthq/teleport-types'
import {
  createHTMLTemplateSyntax,
  HTMLTemplateGenerationParams,
  HTMLTemplateSyntax,
} from '@teleporthq/teleport-plugin-common'
import { UIDLUtils } from '@teleporthq/teleport-shared'

import {
  DEFAULT_VUE_TEMPLATE_CHUNK_NAME,
  DEFAULT_VUE_JS_CHUNK_NAME,
  DEFAULT_JS_CHUNK_AFTER,
} from './constants'

interface VueComponentConfig {
  vueTemplateChunkName: string
  vueJSChunkName: string
  jsChunkAfter: string[]
}

export const createVueComponentPlugin: ComponentPluginFactory<VueComponentConfig> = (config) => {
  const {
    vueTemplateChunkName = DEFAULT_VUE_TEMPLATE_CHUNK_NAME,
    vueJSChunkName = DEFAULT_VUE_JS_CHUNK_NAME,
    jsChunkAfter = DEFAULT_JS_CHUNK_AFTER,
  } = config || {}

  const vueComponentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const { propDefinitions = {}, stateDefinitions = {} } = uidl
    const templateLookup: { [key: string]: unknown } = {}
    const dataObject: Record<string, unknown> = {}
    const methodsObject: Record<string, UIDLEventHandlerStatement[]> = {}

    const params: HTMLTemplateGenerationParams = {
      templateLookup,
      dependencies,
      dataObject,
      methodsObject,
      propDefinitions,
      stateDefinitions,
    }
    const templateSyntaxOptions: HTMLTemplateSyntax = {
      interpolation: (value) => `{{ ${value} }}`,
      eventBinding: (value) => `@${value}`,
      valueBinding: (value) => `:${value}`,
      eventEmmitter: (value) => `this.$emit('${value}')`,
      conditionalAttr: 'v-if',
      repeatAttr: 'v-for',
      repeatIterator: (iteratorName, iteratedCollection, useIndex) => {
        const iterator = useIndex ? `(${iteratorName}, index)` : iteratorName
        return `${iterator} in ${iteratedCollection}`
      },
      customElementTagName: (value) => UIDLUtils.createWebComponentFriendlyName(value),
      dependencyHandling: 'import',
      domHTMLInjection: `v-html`,
      slotBinding: `v-slot`,
      slotTagName: 'template',
    }

    /*
      We need to generate jsx structure of every node that is defined in the UIDL.
      If we use these nodes in the later stage of the code-generation depends on the usage of these nodes.
    */
    for (const propKey of Object.keys(propDefinitions)) {
      const prop = propDefinitions[propKey]
      if (
        prop.type === 'element' &&
        prop.defaultValue !== undefined &&
        typeof prop.defaultValue === 'object'
      ) {
        createHTMLTemplateSyntax(
          prop.defaultValue as UIDLElementNode,
          params,
          templateSyntaxOptions
        )
      }
    }

    const templateContent = createHTMLTemplateSyntax(uidl.node, params, templateSyntaxOptions)

    chunks.push({
      type: ChunkType.HAST,
      name: vueTemplateChunkName,
      fileType: FileType.HTML,
      meta: {
        nodesLookup: templateLookup,
      },
      content: templateContent,
      linkAfter: [],
    })

    const stateObject = extractStateObject(stateDefinitions)

    const jsContent = generateVueComponentJS(
      uidl,
      Object.keys(dependencies).filter((dep) => !dependencies[dep]?.meta?.importJustPath),
      {
        ...stateObject,
        ...dataObject,
      },
      methodsObject
    )

    chunks.push({
      type: ChunkType.AST,
      name: vueJSChunkName,
      fileType: FileType.JS,
      linkAfter: jsChunkAfter,
      content: jsContent,
    })

    return structure
  }

  return vueComponentPlugin
}

export default createVueComponentPlugin()
