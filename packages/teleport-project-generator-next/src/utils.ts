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
// import MagicString from 'magic-string'

export const createDocumentFileChunks = (uidl: ProjectUIDL, options: EntryFileOptions) => {
  const { settings, meta, assets, manifest, customCode } = uidl.globals

  const htmlNode = ASTBuilders.createJSXTag('html')
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
    ASTUtils.addAttributeToJSXTag(linkTag, 'href', `${options.assetsPrefix}/manifest.json`)
    ASTUtils.addChildJSXTag(headNode, linkTag)
  }

  meta.forEach((metaItem) => {
    const metaTag = ASTBuilders.createJSXTag('meta')
    Object.keys(metaItem).forEach((key) => {
      const metaValue = UIDLUtils.prefixAssetsPath(options.assetsPrefix, metaItem[key])
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
  const path = options.globalStyles?.path === '' ? '.' : options.globalStyles.path
  const chunks: ChunkDefinition[] = []
  const result = {
    chunks: {},
    dependencies: options.dependencies,
  }

  if (options.globalStyles?.isGlobalStylesDependent) {
    const contentChunkContent = t.exportDefaultDeclaration(
      t.functionDeclaration(
        t.identifier('MyApp'),
        [
          t.objectPattern([
            t.objectProperty(t.identifier('Component'), t.identifier('Component')),
            t.objectProperty(t.identifier('pageProps'), t.identifier('pageProps')),
          ]),
        ],
        t.blockStatement([
          t.returnStatement(
            t.jsxElement(
              t.jsxOpeningElement(
                t.jsxIdentifier('Component'),
                [t.jsxSpreadAttribute(t.identifier('pageProps'))],
                true
              ),
              null,
              [],
              true
            )
          ),
        ])
      )
    )

    chunks.push({
      type: ChunkType.AST,
      name: 'import-js-chunk',
      fileType: FileType.JS,
      content: t.importDeclaration(
        [],
        t.stringLiteral(`${path}/${options.globalStyles.sheetName}.css`)
      ),
      linkAfter: [],
    })

    chunks.push({
      type: ChunkType.AST,
      name: 'app-js-chunk',
      fileType: FileType.JS,
      content: contentChunkContent,
      linkAfter: ['import-js-chunk'],
    })

    result.chunks = {
      [FileType.JS]: chunks,
    }
  }

  return result
}
