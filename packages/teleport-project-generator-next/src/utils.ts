import { UIDLUtils } from '@teleporthq/teleport-shared'
import { ASTUtils, ASTBuilders } from '@teleporthq/teleport-plugin-common'
import * as types from '@babel/types'
import {
  ProjectUIDL,
  ChunkDefinition,
  EntryFileOptions,
  FileType,
  ChunkType,
  FrameWorkConfigOptions,
} from '@teleporthq/teleport-types'

export const createDocumentFileChunks = (uidl: ProjectUIDL, options: EntryFileOptions) => {
  const { meta, assets, manifest, customCode } = uidl.globals

  const htmlNode = ASTBuilders.createJSXTag('Html')
  // When i18n is configured, Next.js automatically sets the lang attribute
  // on <html> based on the current route locale, so we skip it here.
  if (!uidl.internationalization) {
    const defaultLang = uidl.globals.settings.language
    if (defaultLang) {
      ASTUtils.addAttributeToJSXTag(htmlNode, 'lang', defaultLang)
    }
  }
  addDirectionAttribute(htmlNode, uidl)
  const headNode = ASTBuilders.createJSXTag('Head')
  const bodyNode = ASTBuilders.createJSXTag('body')

  const mainNode = ASTBuilders.createJSXTag('Main')
  const nextScriptNode = ASTBuilders.createJSXTag('NextScript')
  ASTUtils.addChildJSXTag(bodyNode, mainNode)
  ASTUtils.addChildJSXTag(bodyNode, nextScriptNode)

  ASTUtils.addChildJSXTag(htmlNode, headNode)
  ASTUtils.addChildJSXTag(htmlNode, bodyNode)

  // NOTE: Title is added in per page, not in the layout file
  if (manifest) {
    const linkTag = ASTBuilders.createJSXTag('link')
    ASTUtils.addAttributeToJSXTag(linkTag, 'rel', 'manifest')
    ASTUtils.addAttributeToJSXTag(
      linkTag,
      'href',
      UIDLUtils.prefixAssetsPath(`/manifest.json`, options.assets)
    )
    ASTUtils.addChildJSXTag(headNode, linkTag)
  }

  meta.forEach((metaItem) => {
    // Skip viewport meta tags in _document.js — Next.js requires them in _app.js via next/head
    if (metaItem.name === 'viewport') {
      return
    }
    const metaTag = ASTBuilders.createJSXTag('meta')
    Object.keys(metaItem).forEach((key) => {
      const metaValue = UIDLUtils.prefixAssetsPath(metaItem[key], options.assets)
      ASTUtils.addAttributeToJSXTag(metaTag, key, metaValue)
    })
    ASTUtils.addChildJSXTag(headNode, metaTag)
  })

  ASTBuilders.appendAssetsAST(assets, options, headNode, bodyNode)

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

  // Create AST representation of the class CustomDocument extends Document
  // https://github.com/vercel/next.js#custom-document
  const fileAST = createDocumentWrapperAST(htmlNode)

  const chunks: Record<string, ChunkDefinition[]> = {
    [FileType.JS]: [
      {
        name: 'document',
        type: ChunkType.AST,
        fileType: FileType.JS,
        content: fileAST,
        linkAfter: [],
      },
    ],
  }

  return chunks
}

/**
 * Writing direction on `<html>`.
 *
 * Next.js sets `lang` from the route locale for an internationalized project
 * but never sets `dir`, and without it a right-to-left locale renders
 * left-to-right — every logical property in the stylesheet resolves the wrong
 * way, which is worse than not having written them.
 *
 * Both cases come from the editor (`globals.settings`), so the language table
 * lives in one place:
 *  - a single-language RTL project gets a literal `dir="rtl"`;
 *  - an internationalized project with at least one RTL locale gets an
 *    expression over the route locale, because the answer changes per request.
 *
 * A project with no RTL language gets NOTHING — the emitted document is
 * byte-identical to what it was before this existed.
 */
const addDirectionAttribute = (htmlNode: types.JSXElement, uidl: ProjectUIDL, t = types) => {
  const { dir, rtlLocales } = uidl.globals.settings

  if (uidl.internationalization) {
    if (!rtlLocales || rtlLocales.length === 0) {
      return
    }
    // ['ar','he'].indexOf(this.props.__NEXT_DATA__ && this.props.__NEXT_DATA__.locale) !== -1
    //   ? 'rtl' : 'ltr'
    const nextData = t.memberExpression(
      t.memberExpression(t.thisExpression(), t.identifier('props')),
      t.identifier('__NEXT_DATA__')
    )
    const locale = t.logicalExpression(
      '&&',
      nextData,
      t.memberExpression(nextData, t.identifier('locale'))
    )
    const expression = t.conditionalExpression(
      t.binaryExpression(
        '!==',
        t.callExpression(
          t.memberExpression(
            t.arrayExpression(rtlLocales.map((code) => t.stringLiteral(code))),
            t.identifier('indexOf')
          ),
          [locale as types.Expression]
        ),
        t.unaryExpression('-', t.numericLiteral(1))
      ),
      t.stringLiteral('rtl'),
      t.stringLiteral('ltr')
    )
    htmlNode.openingElement.attributes.push(
      t.jsxAttribute(t.jsxIdentifier('dir'), t.jsxExpressionContainer(expression))
    )
    return
  }

  if (dir) {
    ASTUtils.addAttributeToJSXTag(htmlNode, 'dir', dir)
  }
}

const createDocumentWrapperAST = (htmlNode: types.JSXElement, t = types) => {
  return t.program([
    t.importDeclaration(
      [
        t.importDefaultSpecifier(t.identifier('Document')),
        t.importSpecifier(t.identifier('Html'), t.identifier('Html')),
        t.importSpecifier(t.identifier('Head'), t.identifier('Head')),
        t.importSpecifier(t.identifier('Main'), t.identifier('Main')),
        t.importSpecifier(t.identifier('NextScript'), t.identifier('NextScript')),
      ],
      t.stringLiteral('next/document')
    ),
    t.classDeclaration(
      t.identifier('CustomDocument'),
      t.identifier('Document'),
      t.classBody([
        t.classMethod(
          'method',
          t.identifier('render'),
          [],
          t.blockStatement([t.returnStatement(htmlNode)])
        ),
      ]),
      null
    ),
    t.exportDefaultDeclaration(t.identifier('CustomDocument')),
  ])
}

export const configContentGenerator = (options: FrameWorkConfigOptions, t = types) => {
  const isNextIntlUsed = options.dependencies['next-intl']
  const chunks: ChunkDefinition[] = []
  const result = {
    chunks: {},
    dependencies: options.dependencies,
  }

  const jsxComponent = t.jsxElement(
    t.jsxOpeningElement(
      t.jsxIdentifier('Component'),
      [t.jsxSpreadAttribute(t.identifier('pageProps'))],
      true
    ),
    null,
    [],
    true
  )

  const globalContextWrapper = ASTBuilders.createJSXTag('GlobalProvider', [jsxComponent])

  const nextIntlWrapper = ASTBuilders.createJSXTag('NextIntlProvider', [globalContextWrapper])
  nextIntlWrapper.openingElement.attributes.push(
    t.jsxAttribute(
      t.jsxIdentifier('messages'),
      t.jsxExpressionContainer(
        t.optionalMemberExpression(t.identifier('pageProps'), t.identifier('messages'), false, true)
      )
    ),
    t.jsxAttribute(
      t.jsxIdentifier('locale'),
      t.jsxExpressionContainer(
        t.optionalMemberExpression(t.identifier('pageProps'), t.identifier('locale'), false, true)
      )
    )
  )

  // Wrap app content in a Fragment with Head containing viewport meta
  const viewportMeta = ASTBuilders.createSelfClosingJSXTag('meta')
  ASTUtils.addAttributeToJSXTag(viewportMeta, 'name', 'viewport')
  ASTUtils.addAttributeToJSXTag(viewportMeta, 'content', 'width=device-width, initial-scale=1.0')
  const headTag = ASTBuilders.createJSXTag('Head', [viewportMeta])

  const appContent = isNextIntlUsed ? nextIntlWrapper : globalContextWrapper
  const fragment = t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), [
    headTag,
    appContent,
  ])

  const contentChunkContent: Array<types.ImportDeclaration | types.ExportDefaultDeclaration> = [
    t.exportDefaultDeclaration(
      t.functionDeclaration(
        t.identifier('MyApp'),
        [
          t.objectPattern([
            t.objectProperty(t.identifier('Component'), t.identifier('Component'), false, true),
            t.objectProperty(t.identifier('pageProps'), t.identifier('pageProps'), false, true),
          ]),
        ],
        t.blockStatement([t.returnStatement(fragment)])
      )
    ),
  ]

  if (isNextIntlUsed) {
    contentChunkContent.unshift(
      t.importDeclaration(
        [t.importSpecifier(t.identifier('NextIntlProvider'), t.identifier('NextIntlProvider'))],
        types.stringLiteral('next-intl')
      )
    )
  }

  contentChunkContent.unshift(
    t.importDeclaration(
      [t.importSpecifier(t.identifier('GlobalProvider'), t.identifier('GlobalProvider'))],
      types.stringLiteral('../global-context')
    )
  )

  contentChunkContent.unshift(
    t.importDeclaration(
      [t.importDefaultSpecifier(t.identifier('Head'))],
      types.stringLiteral('next/head')
    )
  )

  chunks.push({
    type: ChunkType.AST,
    name: 'app-js-chunk',
    fileType: FileType.JS,
    content: contentChunkContent,
    linkAfter: ['import-js-chunk'],
  })

  // Adding global styles import only when needed. By default we will generate _app.js
  if (options.globalStyles?.isGlobalStylesDependent) {
    chunks.push({
      type: ChunkType.AST,
      name: 'import-js-chunk',
      fileType: FileType.JS,
      content: t.importDeclaration(
        [],
        t.stringLiteral(`${options.globalStyles.path}${options.globalStyles.sheetName}.css`)
      ),
      linkAfter: [],
    })
  }

  result.chunks = {
    [FileType.JS]: chunks,
  }

  return result
}
