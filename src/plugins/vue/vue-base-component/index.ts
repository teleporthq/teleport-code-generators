import { ComponentPlugin, ComponentPluginFactory } from '../../../shared/types'

import {
  splitProps,
  generateEmptyVueComponentJS,
  generateVueComponentPropTypes,
  addTextNodeToTag,
} from './utils'

import { createXMLRoot } from '../../../shared/utils/xml-utils'
import { objectToObjectExpression } from '../../../shared/utils/ast-js-utils'
import { ContentNode, ComponentDependency } from '../../../uidl-definitions/types'

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
    const scriptLookup: { [key: string]: any } = {}

    const templateContent = generateVueNodesTree(uidl.content, templateLookup, dependencies)

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

    const jsContent = generateEmptyVueComponentJS(
      uidl.name,
      {
        importStatements: [],
        componentDeclarations: Object.keys(dependencies),
      },
      scriptLookup
    )

    // todo refactor into pure function
    if (uidl.propDefinitions) {
      scriptLookup.props.value.properties.push(
        ...objectToObjectExpression(generateVueComponentPropTypes(uidl.propDefinitions)).properties
      )
    }

    chunks.push({
      type: 'js',
      name: vueJSChunkName,
      meta: {
        lookup: scriptLookup,
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
  dependencies: Record<string, ComponentDependency>
): CheerioStatic => {
  const { type, key, children, attrs, dependency } = content

  if (dependency) {
    dependencies[type] = { ...dependency }
  }

  const xmlRoot = createXMLRoot(type)
  const xmlNode = xmlRoot(type)

  if (children) {
    children.forEach((child) => {
      if (typeof child === 'string') {
        addTextNodeToTag(xmlNode, child)
        return
      }
      const childTag = generateVueNodesTree(child, templateLookup, dependencies)
      xmlNode.append(childTag.root())
    })
  }

  const { staticProps, dynamicProps } = splitProps(attrs || {})

  Object.keys(staticProps).forEach((propKey) => {
    xmlNode.attr(propKey, staticProps[propKey])
  })

  Object.keys(dynamicProps).forEach((propKey) => {
    const propName = dynamicProps[propKey].replace('$props.', '')
    xmlNode.attr(`:${propKey}`, propName)
  })

  templateLookup[key] = xmlNode

  return xmlRoot
}
