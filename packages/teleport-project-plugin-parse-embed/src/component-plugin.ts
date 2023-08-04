import { ComponentPlugin, ComponentPluginFactory, HastNode } from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import { SUPPORTED_PROJECT_TYPES } from './utils'
import type { JSXElement, JSXIdentifier, JSXText } from '@babel/types'

interface ParseEmbedPluginConfig {
  projectType: SUPPORTED_PROJECT_TYPES
}

const NODE_MAPPER: Record<
  SUPPORTED_PROJECT_TYPES,
  Promise<(content: unknown, options: unknown) => string>
> = {
  'teleport-project-html': import('hast-util-to-html').then((mod) => mod.toHtml),
  'teleport-project-react': import('hast-util-to-jsx-inline-script').then((mod) => mod.default),
  'teleport-project-next': import('hast-util-to-jsx-inline-script').then((mod) => mod.default),
}

const COMPONENT_CHUNK_NAMES: Record<SUPPORTED_PROJECT_TYPES, string> = {
  'teleport-project-html': 'html-chunk',
  'teleport-project-next': 'jsx-component',
  'teleport-project-react': 'jsx-component',
}

export const createParseEmbedPlugin: ComponentPluginFactory<ParseEmbedPluginConfig> = (config) => {
  const { projectType } = config

  if (!NODE_MAPPER[projectType]) {
    throw new Error(`Received a invalid ${projectType}`)
  }

  const componentPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure
    const compontnChunk = chunks.find((chunk) => chunk.name === COMPONENT_CHUNK_NAMES[projectType])

    if (!compontnChunk) {
      throw new Error(`MIssing component chunk to parse for embeds`)
    }

    const fromHtml = (await import('hast-util-from-html')).fromHtml
    const hastToJsxOrHtml = await NODE_MAPPER[projectType]

    UIDLUtils.traverseElements(uidl.node, (element) => {
      const { key, elementType, attrs } = element

      if (
        (elementType === 'dangerous-html' || element.dependency?.path === 'dangerous-html') &&
        attrs?.html
      ) {
        const hastNodes = fromHtml(element.attrs.html.content as string, {
          fragment: true,
        })
        const content = hastToJsxOrHtml(hastNodes, { wrapper: 'fragment' })

        if (projectType === 'teleport-project-html') {
          const node = compontnChunk.meta.nodesLookup[key] as HastNode
          if (!node) {
            return
          }
          /*
            Convert the HastNode to HastText
          */

          Object.assign(node, {
            type: 'text',
            value: content,
          })

          delete node.children
          delete node.properties
          delete dependencies['dangerous-html']
        } else {
          const node = compontnChunk.meta.nodesLookup[key] as JSXElement
          if (!node) {
            return
          }
          ;(node.openingElement.name as JSXIdentifier).name = 'React.Fragment'
          ;(node.closingElement.name as JSXIdentifier).name = 'React.Fragment'
          node.openingElement.attributes = []
          node.children.push({
            type: 'JSXText' as const,
            value: content,
          } as JSXText)
        }
      }
    })

    return structure
  }

  return componentPlugin
}
