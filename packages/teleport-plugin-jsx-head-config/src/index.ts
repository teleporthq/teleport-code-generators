import {
  ComponentPluginFactory,
  ComponentPlugin,
  UIDLDynamicReference,
  UIDLStaticValue,
} from '@teleporthq/teleport-types'
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
      const titleAST = generateTitleAST(uidl.seo.title)
      headASTTags.push(titleAST)
    }

    if (uidl.seo.metaTags) {
      uidl.seo.metaTags.forEach((tag) => {
        const metaAST = ASTBuilders.createSelfClosingJSXTag('meta')
        Object.keys(tag).forEach((key) => {
          const value = tag[key]
          addAttributeToMetaTag(metaAST, key, value)
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

  const addAttributeToMetaTag = (
    metaTag: types.JSXElement,
    key: string,
    value: string | UIDLStaticValue | UIDLDynamicReference
  ) => {
    if (typeof value === 'string') {
      ASTUtils.addAttributeToJSXTag(metaTag, key, value)
      return
    }

    const isDynamic = value.type === 'dynamic'
    if (!isDynamic) {
      ASTUtils.addAttributeToJSXTag(metaTag, key, value!.content.toString())
      return
    }

    if (value.content.referenceType !== 'prop') {
      throw new Error(`Only prop references are supported for dynamic meta tags`)
    }

    let content = `props`
    value.content.refPath?.forEach((pathItem) => {
      content = content.concat(`?.${pathItem}`)
    })

    metaTag.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier(key),
        types.jsxExpressionContainer(types.identifier(content))
      )
    )
  }

  const generateTitleAST = (title: string | UIDLStaticValue | UIDLDynamicReference) => {
    const titleAST = ASTBuilders.createJSXTag('title')

    if (typeof title === 'string') {
      ASTUtils.addChildJSXText(titleAST, title)
      return titleAST
    }

    const isDynamic = title.type === 'dynamic'
    if (!isDynamic) {
      ASTUtils.addChildJSXText(titleAST, title!.content.toString())
      return titleAST
    }

    if (title.content.referenceType !== 'prop') {
      throw new Error(`Only prop references are supported for dynamic titles`)
    }

    const expresContainer = types.jsxExpressionContainer(
      ASTUtils.generateMemberExpressionASTFromBase(
        types.identifier('props'),
        title.content.refPath || []
      )
    )

    titleAST.children.push(expresContainer)
    return titleAST
  }

  return jsxHeadConfigPlugin
}

export default createJSXHeadConfigPlugin()
