import { camelCaseToDashCase } from '@teleporthq/teleport-shared/lib/utils/string-utils'
import {
  splitDynamicAndStaticStyles,
  cleanupNestedStyles,
  traverseElements,
} from '@teleporthq/teleport-shared/lib/utils/uidl-utils'
import { createCSSClass } from '@teleporthq/teleport-shared/lib/builders/css-builders'
import { getContentOfStyleObject } from '@teleporthq/teleport-shared/lib/utils/jss-utils'
import {
  addClassToNode,
  addAttributeToNode,
} from '@teleporthq/teleport-shared/lib/utils/html-utils'
import {
  ComponentPlugin,
  ComponentPluginFactory,
  UIDLDynamicReference,
} from '@teleporthq/teleport-types'
import { FILE_TYPE } from '../../teleport-generator-shared/lib/constants'

interface AngularStyleChunkConfig {
  chunkName: string
  vueJSChunk: string
  angularTemplateChunk: string
  styleFileId: string
}

export const createPlugin: ComponentPluginFactory<AngularStyleChunkConfig> = (config) => {
  const {
    chunkName = 'angular-style-chuk',
    angularTemplateChunk = 'angular-template-chunk',
    styleFileId = FILE_TYPE.CSS,
  } = config || {}

  const angularComponentStyleChunkPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks } = structure

    const { node } = uidl

    const templateChunk = chunks.filter((chunk) => chunk.name === angularTemplateChunk)[0]
    const templateLookup = templateChunk.meta.lookup

    const jssStylesArray = []

    traverseElements(node, (element) => {
      const { style, key } = element

      if (style && Object.keys(style).length > 0) {
        const { staticStyles, dynamicStyles } = splitDynamicAndStaticStyles(style)
        const root = templateLookup[key]
        const className = camelCaseToDashCase(key)
        jssStylesArray.push(createCSSClass(className, getContentOfStyleObject(staticStyles)))

        if (Object.keys(dynamicStyles).length) {
          const rootStyles = cleanupNestedStyles(dynamicStyles)

          const angularFriendlyBinding = Object.keys(rootStyles).map((styleKey) => {
            const { content } = rootStyles[styleKey] as UIDLDynamicReference

            return `${styleKey}: ${content.id}`
          })

          addAttributeToNode(root, '[ngStyle]', `{${angularFriendlyBinding.join(', ')}}`)
        }

        addClassToNode(root, className)
      }
    })

    if (jssStylesArray.length > 0) {
      chunks.push({
        type: 'string',
        name: chunkName,
        meta: {
          fileId: styleFileId,
        },
        content: jssStylesArray.join('\n'),
        linkAfter: [],
      })
    }

    return structure
  }

  return angularComponentStyleChunkPlugin
}

export default createPlugin()
