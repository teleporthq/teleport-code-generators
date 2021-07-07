import * as types from '@babel/types'
import {
  ProjectUIDL,
  EntryFileOptions,
  ChunkDefinition,
  FileType,
  ChunkType,
  FrameWorkConfigOptions,
} from '@teleporthq/teleport-types'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import { ASTBuilders, ASTUtils } from '@teleporthq/teleport-plugin-common'

export const createCustomHTMLEntryFile = (
  uidl: ProjectUIDL,
  options: EntryFileOptions,
  t = types
) => {
  const exportBody = t.exportDefaultDeclaration(
    t.functionDeclaration(
      t.identifier('HTML'),
      [t.identifier('props')],
      t.blockStatement([t.returnStatement(generateHTMLNode(uidl, options))])
    )
  )

  const chunks: Record<string, ChunkDefinition[]> = {
    [FileType.JS]: [
      {
        name: 'import-chunks',
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: [createImportAST('React', 'react'), createImportAST('PropTypes', 'prop-types')],
        linkAfter: [],
      },
      {
        name: 'jsx-body',
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: [exportBody],
        linkAfter: ['import-chunk'],
      },
      {
        name: 'prop-types',
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: [createPropTypesChunk()],
        linkAfter: ['import-chunks', 'jsx-body'],
      },
    ],
  }

  return chunks
}

const createImportAST = (specifier: string, target: string, t = types) => {
  return t.importDeclaration(
    [t.importDefaultSpecifier(t.identifier(specifier))],
    t.stringLiteral(target)
  )
}

const generateHTMLNode = (uidl: ProjectUIDL, options: EntryFileOptions, t = types) => {
  const { settings, meta, assets, customCode } = uidl.globals

  const htmlNode = ASTBuilders.createJSXTag('html')
  const headNode = ASTBuilders.createJSXTag('head')
  const bodyNode = ASTBuilders.createJSXTag('body')
  const noScriptNode = ASTBuilders.createJSXTag('noscript')

  if (uidl.globals.manifest) {
    const manifestTag = ASTBuilders.createJSXTag('link')
    ASTUtils.addAttributeToJSXTag(manifestTag, 'rel', 'manifest')
    ASTUtils.addAttributeToJSXTag(manifestTag, 'href', '/manifest.json')
    ASTUtils.addChildJSXTag(headNode, manifestTag)
  }

  const charSetMetaTag = ASTBuilders.createSelfClosingJSXTag('meta')
  ASTUtils.addAttributeToJSXTag(charSetMetaTag, 'charSet', 'utf-8')
  ASTUtils.addChildJSXTag(headNode, charSetMetaTag)

  const httpMetaTag = ASTBuilders.createSelfClosingJSXTag('meta')
  ASTUtils.addAttributeToJSXTag(httpMetaTag, 'httpEquiv', 'x-ua-compatible')
  ASTUtils.addAttributeToJSXTag(httpMetaTag, 'content', 'ie=edge')
  ASTUtils.addChildJSXTag(headNode, httpMetaTag)

  const viewPortMeta = ASTBuilders.createSelfClosingJSXTag('meta')
  ASTUtils.addAttributeToJSXTag(viewPortMeta, 'name', 'viewport')
  ASTUtils.addAttributeToJSXTag(
    viewPortMeta,
    'content',
    'width=device-width, initial-scale=1, shrink-to-fit=no'
  )
  ASTUtils.addChildJSXTag(headNode, viewPortMeta)

  addJSXExpressionContainer(bodyNode, 'props', 'preBodyComponents')

  ASTUtils.addChildJSXText(noScriptNode, 'This app works best with JavaScript enabled.')
  ASTUtils.addAttributeToJSXTag(noScriptNode, 'key', 'noscript')
  ASTUtils.addAttributeToJSXTag(noScriptNode, 'id', 'gatsby-noscript')
  ASTUtils.addChildJSXTag(bodyNode, noScriptNode)

  addSpreadAttributes(htmlNode, 'props', 'htmlAttributes')
  addSpreadAttributes(bodyNode, 'props', 'bodyAttributes')
  addJSXExpressionContainer(headNode, 'props', 'headComponents')

  if (settings.language) {
    ASTUtils.addAttributeToJSXTag(htmlNode, 'lang', settings.language)
  }

  ASTBuilders.appendAssetsAST(assets, options, headNode, bodyNode)

  meta.forEach((metaItem) => {
    const metaTag = ASTBuilders.createJSXTag('meta')
    Object.keys(metaItem).forEach((key) => {
      const metaValue = UIDLUtils.prefixAssetsPath(options.assetsPrefix, metaItem[key])
      ASTUtils.addAttributeToJSXTag(metaTag, key, metaValue)
    })
    ASTUtils.addChildJSXTag(headNode, metaTag)
  })

  const bodyDiv = ASTBuilders.createSelfClosingJSXTag('div')
  ASTUtils.addAttributeToJSXTag(bodyDiv, 'id', '___gatsby')
  bodyDiv.openingElement.attributes.push(
    t.jsxAttribute(
      t.jsxIdentifier('key'),
      t.jsxExpressionContainer(
        t.templateLiteral([t.templateElement({ raw: 'body', cooked: 'body' })], [])
      )
    )
  )
  bodyDiv.openingElement.attributes.push(
    t.jsxAttribute(
      t.jsxIdentifier('dangerouslySetInnerHTML'),
      t.jsxExpressionContainer(
        t.objectExpression([
          t.objectProperty(
            t.identifier('__html'),
            t.memberExpression(t.identifier('props'), t.identifier('body'))
          ),
        ])
      )
    )
  )

  ASTUtils.addChildJSXTag(bodyNode, bodyDiv)

  addJSXExpressionContainer(bodyNode, 'props', 'postBodyComponents')

  if (customCode?.head) {
    // This is a workaround for inserting <style> <script> <link> etc. directly in <head>
    // It inserts <noscript></noscript> content <noscript></noscript>
    // The first tag (closing) is closing the root <noscript>
    // The second tag (opening) is for the root closing </noscript>
    const innerHTML = `</noscript>${customCode.head}<noscript>`
    const noScript = ASTBuilders.createJSXTag('noscript')
    ASTUtils.addAttributeToJSXTag(noScript, 'dangerouslySetInnerHTML', { __html: innerHTML })
    ASTUtils.addChildJSXTag(headNode, noScript)
  }

  if (customCode?.body) {
    const divNode = ASTBuilders.createJSXTag('div')
    ASTUtils.addAttributeToJSXTag(divNode, 'dangerouslySetInnerHTML', { __html: customCode.body })
    ASTUtils.addChildJSXTag(bodyNode, divNode)
  }

  ASTUtils.addChildJSXTag(htmlNode, headNode)
  ASTUtils.addChildJSXTag(htmlNode, bodyNode)

  return htmlNode
}

const addJSXExpressionContainer = (
  jsxElement: types.JSXElement,
  propPrefix: string,
  propName: string,
  t = types
) => {
  return jsxElement.children.push(
    t.jsxExpressionContainer(t.memberExpression(t.identifier(propPrefix), t.identifier(propName)))
  )
}

const addSpreadAttributes = (
  jsxElement: types.JSXElement,
  propPrefix: string,
  propName: string,
  t = types
) => {
  return jsxElement.openingElement.attributes.push(
    t.jsxSpreadAttribute(t.memberExpression(t.identifier(propPrefix), t.identifier(propName)))
  )
}

const createPropTypesChunk = (t = types) => {
  return t.expressionStatement(
    t.assignmentExpression(
      '=',
      t.memberExpression(t.identifier('HTML'), t.identifier('propTypes')),
      t.objectExpression([
        createObjectpropertyAST('htmlAttributes', 'PropTypes', 'object'),
        createObjectpropertyAST('headComponents', 'PropTypes', 'array'),
        createObjectpropertyAST('bodyAttributes', 'PropTypes', 'object'),
        createObjectpropertyAST('preBodyComponents', 'PropTypes', 'array'),
        createObjectpropertyAST('body', 'PropTypes', 'string'),
        createObjectpropertyAST('postBodyComponents', 'PropTypes', 'array'),
      ])
    )
  )
}

const createObjectpropertyAST = (
  attributeName: string,
  prefix: string,
  attributeType: string,
  t = types
) => {
  return t.objectProperty(
    t.identifier(attributeName),
    t.memberExpression(t.identifier(prefix), t.identifier(attributeType))
  )
}

export const styleSheetDependentConfigGenerator = (options: FrameWorkConfigOptions, t = types) => {
  const chunks: ChunkDefinition[] = []
  const result = {
    chunks: {},
    dependencies: options.dependencies,
  }

  const {
    globalStyles: { path, sheetName, isGlobalStylesDependent },
  } = options

  if (isGlobalStylesDependent) {
    chunks.push({
      type: ChunkType.AST,
      name: 'import-js-chunk',
      fileType: FileType.JS,
      content: t.importDeclaration([], t.stringLiteral(`./${path}/${sheetName}.module.css`)),
      linkAfter: [],
    })
  }

  result.chunks = {
    [FileType.JS]: chunks,
  }

  return result
}
