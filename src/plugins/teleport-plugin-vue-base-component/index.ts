import { ComponentPlugin, ComponentPluginFactory } from '../../shared/types'

import { generateVueComponentJS, addTextNodeToTag } from './utils'

import { createHTMLNode, addAttributeToNode, addChildNode } from '../../shared/utils/html-utils'
import { ContentNode, ComponentDependency } from '../../uidl-definitions/types'
import { isDynamicPrefixedValue, removeDynamicPrefix } from '../../shared/utils/uidl-utils'

interface VueComponentConfig {
  vueTemplateChunkName: string
  vueJSChunkName: string
  htmlFileId: string
  jsFileAfter: string[]
  jsFileId: string
}

export const createPlugin: ComponentPluginFactory<VueComponentConfig> = (config) => {
  const {
    vueTemplateChunkName = 'vue-template-chunk',
    vueJSChunkName = 'vue-js-chunk',
    htmlFileId = 'vuehtml',
    jsFileId = 'vuejs',
    jsFileAfter = ['import-lib', 'import-pack', 'import-local'],
  } = config || {}

  const vueBasicComponentChunks: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const templateLookup: { [key: string]: any } = {}
    const dataObject: Record<string, any> = {}

    const templateContent = generateVueNodesTree(
      uidl.content,
      templateLookup,
      dependencies,
      dataObject
    )

    chunks.push({
      type: 'html',
      name: vueTemplateChunkName,
      meta: {
        lookup: templateLookup,
        fileId: htmlFileId,
      },
      content: templateContent,
      linkAfter: [],
    })

    const jsContent = generateVueComponentJS(uidl, Object.keys(dependencies), dataObject)

    chunks.push({
      type: 'js',
      name: vueJSChunkName,
      meta: {
        fileId: jsFileId,
      },
      linkAfter: jsFileAfter,
      content: jsContent,
    })

    return structure
  }

  return vueBasicComponentChunks
}

export default createPlugin()

const generateVueNodesTree = (
  content: ContentNode,
  templateLookup: Record<string, any>,
  dependencies: Record<string, ComponentDependency>,
  dataObject: Record<string, any>
) => {
  const { type, key, children, attrs, dependency, repeat } = content

  if (dependency) {
    dependencies[type] = { ...dependency }
  }

  const htmlNode = createHTMLNode(type)

  if (children) {
    children.forEach((child) => {
      if (typeof child === 'string') {
        // $props. $state. $local. prefixed string values
        if (isDynamicPrefixedValue(child)) {
          // special treatment for $props.children where we need to add a <slot></slot> tag
          if (child === '$props.children') {
            const slot = createHTMLNode('slot')
            addChildNode(htmlNode, slot)
          } else {
            addTextNodeToTag(htmlNode, `{{${removeDynamicPrefix(child)}}}`)
          }
        } else {
          addTextNodeToTag(htmlNode, child)
        }
        return
      }
      const childTag = generateVueNodesTree(child, templateLookup, dependencies, dataObject)
      addChildNode(htmlNode, childTag)
    })
  }

  if (repeat) {
    const { dataSource, content: repeatContent, meta = {} } = repeat
    const repeatContentTag = generateVueNodesTree(
      repeatContent,
      templateLookup,
      dependencies,
      dataObject
    )

    let dataObjectIdentifier = meta.dataSourceIdentifier || 'items'
    if (typeof dataSource === 'string' && dataSource.startsWith('$props.')) {
      dataObjectIdentifier = dataSource.replace('$props.', '')
    } else {
      // TODO check if data identifier is not used before or if it is a prop
      dataObject[dataObjectIdentifier] = dataSource
    }

    const iteratorName = meta.iteratorName || 'item'
    const iterator = meta.useIndex ? `(${iteratorName}, index)` : iteratorName
    const keyIdentifier = meta.useIndex ? 'index' : iteratorName

    addAttributeToNode(repeatContentTag, 'v-for', `${iterator} in ${dataObjectIdentifier}`)
    addAttributeToNode(repeatContentTag, ':key', `${keyIdentifier}`)
    addChildNode(htmlNode, repeatContentTag)
  }

  if (attrs) {
    Object.keys(attrs).forEach((attrKey) => {
      if (isDynamicPrefixedValue(attrs[attrKey])) {
        const attrValue = removeDynamicPrefix(attrs[attrKey])
        addAttributeToNode(htmlNode, `:${attrKey}`, attrValue)
      } else {
        addAttributeToNode(htmlNode, attrKey, attrs[attrKey])
      }
    })
  }

  templateLookup[key] = htmlNode

  return htmlNode
}
