import { ComponentPluginFactory, ComponentPlugin } from '@teleporthq/teleport-types'
import { ASTBuilders, ASTUtils } from '@teleporthq/teleport-plugin-common'
import * as types from '@babel/types'

interface JSXHeadPluginConfig {
  componentChunkName?: string
  configTagIdentifier?: string
  configTagDependencyPath?: string
  configTagDependencyVersion?: string
  isExternalPackage?: boolean
  isDefaultImport?: boolean
}

export const createJSXHeadConfigPlugin: ComponentPluginFactory<JSXHeadPluginConfig> = (config) => {
  const {
    componentChunkName = 'jsx-component',
    configTagIdentifier = 'Helmet',
    configTagDependencyPath = 'react-helmet',
    configTagDependencyVersion = '^6.1.0',
    isExternalPackage = true,
    isDefaultImport = false,
  } = config || {}

  const jsxHeadConfigPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies } = structure

    const componentChunk = chunks.find((chunk) => chunk.name === componentChunkName)
    if (!componentChunk) {
      throw new Error(
        `JSX component chunk with name ${componentChunkName} was required and not found.`
      )
    }

    if (!uidl.seo) {
      return structure
    }

    const headASTTags = []

    if (uidl.seo.title) {
      const titleAST = ASTBuilders.createJSXTag('title')
      ASTUtils.addChildJSXText(titleAST, uidl.seo.title)
      headASTTags.push(titleAST)
    }

    if (uidl.seo.metaTags) {
      uidl.seo.metaTags.forEach((tag) => {
        const metaAST = ASTBuilders.createSelfClosingJSXTag('meta')
        Object.keys(tag).forEach((key) => {
          ASTUtils.addAttributeToJSXTag(metaAST, key, tag[key])
        })
        headASTTags.push(metaAST)
      })
    }

    if (uidl.seo.assets) {
      uidl.seo.assets.forEach((asset) => {
        // TODO: Handle other asset types when needed
        if (asset.type === 'canonical') {
          const canonicalLink = ASTBuilders.createSelfClosingJSXTag('link')
          ASTUtils.addAttributeToJSXTag(canonicalLink, 'rel', 'canonical')
          ASTUtils.addAttributeToJSXTag(canonicalLink, 'href', asset.path)
          headASTTags.push(canonicalLink)
        }
      })
    }

    if (headASTTags.length > 0) {
      const headConfigTag = ASTBuilders.createJSXTag(configTagIdentifier, headASTTags)

      const rootKey = uidl.node.content.key
      // @ts-ignore
      const rootElement = componentChunk.meta.nodesLookup[rootKey] as types.JSXElement

      // Head config added as the first child of the root element
      rootElement.children.unshift(headConfigTag)

      dependencies[configTagIdentifier] = {
        type: isExternalPackage ? 'package' : 'library',
        path: configTagDependencyPath,
        version: configTagDependencyVersion,
        ...(!isDefaultImport && {
          meta: {
            namedImport: true,
          },
        }),
      }
    }

    return structure
  }

  return jsxHeadConfigPlugin
}

export default createJSXHeadConfigPlugin()
