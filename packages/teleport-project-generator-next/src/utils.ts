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
  const useViewTransition = Boolean(options.viewTransition)
  const chunks: ChunkDefinition[] = []
  const result = {
    chunks: {},
    dependencies: options.dependencies,
  }

  const renderedPagePropsSpread = useViewTransition
    ? t.jsxSpreadAttribute(t.memberExpression(t.identifier('page'), t.identifier('pageProps')))
    : t.jsxSpreadAttribute(t.identifier('pageProps'))

  const jsxComponent = t.jsxElement(
    t.jsxOpeningElement(
      useViewTransition
        ? t.jsxMemberExpression(t.jsxIdentifier('page'), t.jsxIdentifier('Component'))
        : t.jsxIdentifier('Component'),
      [renderedPagePropsSpread],
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

  const bodyStatements: types.Statement[] = useViewTransition ? buildViewTransitionBody(t) : []
  bodyStatements.push(t.returnStatement(fragment))

  const contentChunkContent: Array<
    types.ImportDeclaration | types.ExportDefaultDeclaration | types.VariableDeclaration
  > = []

  if (useViewTransition) {
    contentChunkContent.push(
      buildDisabledPathsDeclaration(options.viewTransition!.disabledPaths, t)
    )
  }

  contentChunkContent.push(
    t.exportDefaultDeclaration(
      t.functionDeclaration(
        t.identifier('MyApp'),
        [
          t.objectPattern([
            t.objectProperty(t.identifier('Component'), t.identifier('Component'), false, true),
            t.objectProperty(t.identifier('pageProps'), t.identifier('pageProps'), false, true),
          ]),
        ],
        t.blockStatement(bodyStatements)
      )
    )
  )

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

  if (useViewTransition) {
    contentChunkContent.unshift(
      t.importDeclaration(
        [t.importSpecifier(t.identifier('useRouter'), t.identifier('useRouter'))],
        t.stringLiteral('next/router')
      )
    )
    contentChunkContent.unshift(
      t.importDeclaration(
        [t.importSpecifier(t.identifier('flushSync'), t.identifier('flushSync'))],
        t.stringLiteral('react-dom')
      )
    )
    contentChunkContent.unshift(
      t.importDeclaration(
        [
          t.importSpecifier(t.identifier('useState'), t.identifier('useState')),
          t.importSpecifier(t.identifier('useEffect'), t.identifier('useEffect')),
          t.importSpecifier(t.identifier('useRef'), t.identifier('useRef')),
        ],
        t.stringLiteral('react')
      )
    )
  }

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

/**
 * Emits the hook-based body that powers the View Transition API swap:
 *
 *   const router = useRouter()
 *   const [page, setPage] = useState({ Component, pageProps })
 *   const displayedPath = useRef(router.asPath)
 *   useEffect(() => {
 *     const nextPath = router.asPath
 *     const isNavigation = displayedPath.current !== nextPath
 *     const prevDisabled = DISABLED_VTA_PATHS.has(displayedPath.current)
 *     const nextDisabled = DISABLED_VTA_PATHS.has(nextPath)
 *     displayedPath.current = nextPath
 *     const swap = () => flushSync(() => setPage({ Component, pageProps }))
 *     if (
 *       isNavigation &&
 *       !prevDisabled &&
 *       !nextDisabled &&
 *       typeof document !== 'undefined' &&
 *       document.startViewTransition
 *     ) {
 *       document.startViewTransition(swap)
 *     } else {
 *       setPage({ Component, pageProps })
 *     }
 *   }, [router.asPath, Component, pageProps])
 */
const buildViewTransitionBody = (t: typeof types): types.Statement[] => {
  const pageInit = t.objectExpression([
    t.objectProperty(t.identifier('Component'), t.identifier('Component'), false, true),
    t.objectProperty(t.identifier('pageProps'), t.identifier('pageProps'), false, true),
  ])

  const routerDecl = t.variableDeclaration('const', [
    t.variableDeclarator(t.identifier('router'), t.callExpression(t.identifier('useRouter'), [])),
  ])

  const pageStateDecl = t.variableDeclaration('const', [
    t.variableDeclarator(
      t.arrayPattern([t.identifier('page'), t.identifier('setPage')]),
      t.callExpression(t.identifier('useState'), [pageInit])
    ),
  ])

  const displayedPathDecl = t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier('displayedPath'),
      t.callExpression(t.identifier('useRef'), [
        t.memberExpression(t.identifier('router'), t.identifier('asPath')),
      ])
    ),
  ])

  const setPageCall = (): types.CallExpression =>
    t.callExpression(t.identifier('setPage'), [
      t.objectExpression([
        t.objectProperty(t.identifier('Component'), t.identifier('Component'), false, true),
        t.objectProperty(t.identifier('pageProps'), t.identifier('pageProps'), false, true),
      ]),
    ])

  const effectBody = t.blockStatement([
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier('nextPath'),
        t.memberExpression(t.identifier('router'), t.identifier('asPath'))
      ),
    ]),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier('isNavigation'),
        t.binaryExpression(
          '!==',
          t.memberExpression(t.identifier('displayedPath'), t.identifier('current')),
          t.identifier('nextPath')
        )
      ),
    ]),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier('prevDisabled'),
        t.callExpression(
          t.memberExpression(t.identifier('DISABLED_VTA_PATHS'), t.identifier('has')),
          [t.memberExpression(t.identifier('displayedPath'), t.identifier('current'))]
        )
      ),
    ]),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier('nextDisabled'),
        t.callExpression(
          t.memberExpression(t.identifier('DISABLED_VTA_PATHS'), t.identifier('has')),
          [t.identifier('nextPath')]
        )
      ),
    ]),
    t.expressionStatement(
      t.assignmentExpression(
        '=',
        t.memberExpression(t.identifier('displayedPath'), t.identifier('current')),
        t.identifier('nextPath')
      )
    ),
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier('swap'),
        t.arrowFunctionExpression(
          [],
          t.callExpression(t.identifier('flushSync'), [
            t.arrowFunctionExpression([], setPageCall()),
          ])
        )
      ),
    ]),
    t.ifStatement(
      t.logicalExpression(
        '&&',
        t.logicalExpression(
          '&&',
          t.logicalExpression(
            '&&',
            t.logicalExpression(
              '&&',
              t.identifier('isNavigation'),
              t.unaryExpression('!', t.identifier('prevDisabled'))
            ),
            t.unaryExpression('!', t.identifier('nextDisabled'))
          ),
          t.binaryExpression(
            '!==',
            t.unaryExpression('typeof', t.identifier('document')),
            t.stringLiteral('undefined')
          )
        ),
        t.memberExpression(t.identifier('document'), t.identifier('startViewTransition'))
      ),
      t.blockStatement([
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(t.identifier('document'), t.identifier('startViewTransition')),
            [t.identifier('swap')]
          )
        ),
      ]),
      t.blockStatement([t.expressionStatement(setPageCall())])
    ),
  ])

  const effectDecl = t.expressionStatement(
    t.callExpression(t.identifier('useEffect'), [
      t.arrowFunctionExpression([], effectBody),
      t.arrayExpression([
        t.memberExpression(t.identifier('router'), t.identifier('asPath')),
        t.identifier('Component'),
        t.identifier('pageProps'),
      ]),
    ])
  )

  return [routerDecl, pageStateDecl, displayedPathDecl, effectDecl]
}

const buildDisabledPathsDeclaration = (
  paths: string[],
  t: typeof types
): types.VariableDeclaration => {
  return t.variableDeclaration('const', [
    t.variableDeclarator(
      t.identifier('DISABLED_VTA_PATHS'),
      t.newExpression(t.identifier('Set'), [
        t.arrayExpression(paths.map((p) => t.stringLiteral(p))),
      ])
    ),
  ])
}
