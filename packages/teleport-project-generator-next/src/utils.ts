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
  const { settings, meta, assets, manifest, customCode } = uidl.globals

  const htmlNode = ASTBuilders.createJSXTag('Html')
  const headNode = ASTBuilders.createJSXTag('Head')
  const bodyNode = ASTBuilders.createJSXTag('body')

  const mainNode = ASTBuilders.createJSXTag('Main')
  const nextScriptNode = ASTBuilders.createJSXTag('NextScript')
  ASTUtils.addChildJSXTag(bodyNode, mainNode)
  ASTUtils.addChildJSXTag(bodyNode, nextScriptNode)

  ASTUtils.addChildJSXTag(htmlNode, headNode)
  ASTUtils.addChildJSXTag(htmlNode, bodyNode)

  if (settings.language) {
    ASTUtils.addAttributeToJSXTag(htmlNode, 'lang', settings.language)
  }

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
    )
  )

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
        t.blockStatement([
          t.returnStatement(isNextIntlUsed ? nextIntlWrapper : globalContextWrapper),
        ])
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
