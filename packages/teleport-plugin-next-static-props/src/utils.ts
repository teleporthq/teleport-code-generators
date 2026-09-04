import * as types from '@babel/types'
import { ASTUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLInitialPropsData, UIDLResources } from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'

export const generateInitialPropsAST = (
  initialPropsData: UIDLInitialPropsData,
  resourceImportName: string,
  globalCache: UIDLResources['cache'],
  skipI18n?: boolean,
  /**
   * Dashboard-layout admin CRUD pages (entity-bound, dynamic-route pages
   * like edit-item/[id]) render with getServerSideProps instead of
   * getStaticProps+ISR: an admin who just saved a row must see the fresh
   * value on the very next request, not after the cache.revalidate window
   * elapses (the "Edit Press Item" staleness bug — a real DB write that
   * looked like it "didn't save" because ISR kept serving the pre-save
   * snapshot for up to 60s). Admin panels are low-traffic and already
   * auth-gated per request, so there is no real CDN-caching upside being
   * traded away. See `createStaticPropsPlugin` for the selection logic.
   */
  useServerSideProps?: boolean
) => {
  // Destructure params from context so expr-type resource params can reference `params` directly
  const paramsDestructureAST = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.objectPattern([
        types.objectProperty(
          types.identifier('params'),
          types.assignmentPattern(types.identifier('params'), types.objectExpression([])),
          false,
          true
        ),
      ]),
      types.identifier('context')
    ),
  ])

  const functionContentAST = types.blockStatement([
    paramsDestructureAST,
    types.tryStatement(
      types.blockStatement([
        ...computePropsAST(
          initialPropsData,
          resourceImportName,
          globalCache,
          skipI18n,
          useServerSideProps
        ),
      ]),
      types.catchClause(
        types.identifier('error'),
        types.blockStatement([
          types.expressionStatement(
            types.callExpression(
              types.memberExpression(types.identifier('console'), types.identifier('log')),
              [types.identifier('error')]
            )
          ),
          types.returnStatement(
            types.objectExpression([
              types.objectProperty(types.identifier('notFound'), types.booleanLiteral(true)),
            ])
          ),
        ])
      )
    ),
  ])

  return types.exportNamedDeclaration(
    (() => {
      const node = types.functionDeclaration(
        types.identifier(useServerSideProps ? 'getServerSideProps' : 'getStaticProps'),
        [types.identifier('context')],
        functionContentAST,
        false,
        true
      )

      node.async = true
      return node
    })()
  )
}

const computePropsAST = (
  initialPropsData: UIDLInitialPropsData,
  resourceImportName: string,
  globalCache: UIDLResources['cache'],
  skipI18n?: boolean,
  useServerSideProps?: boolean
) => {
  const funcParams: types.ObjectProperty[] = Object.keys(
    initialPropsData.resource?.params || {}
  ).reduce((acc: types.ObjectProperty[], item) => {
    const prop = initialPropsData.resource.params[item]
    acc.push(types.objectProperty(types.stringLiteral(item), ASTUtils.resolveObjectValue(prop)))

    return acc
  }, [])

  /*
    Per-page cache can override the global cache.
    Gobally the project don't need to have a cache.
    But for a specific page, it can have a cache.
    Eg:
      Handling paths
      - /blog-posts
      - /blog-pots/${id}

      using webhook. And then letting page cache handler to do pages like
      - /blog-posts/page/${id}
  */
  const perPageCache = initialPropsData.cache
  let cachePropertyAST: types.ObjectProperty | null = null

  // getServerSideProps re-runs on every request — there is no revalidate
  // window to configure, and Next.js errors if the prop is present.
  if (!useServerSideProps) {
    if (globalCache?.revalidate && !perPageCache?.revalidate) {
      cachePropertyAST = types.objectProperty(
        types.identifier('revalidate'),
        types.numericLiteral(globalCache.revalidate)
      )
    }

    if (perPageCache?.revalidate) {
      cachePropertyAST = types.objectProperty(
        types.identifier('revalidate'),
        types.numericLiteral(perPageCache.revalidate)
      )
    }
  }

  const localeAST = skipI18n
    ? []
    : [
        types.spreadElement(
          types.logicalExpression(
            '&&',
            types.optionalMemberExpression(
              types.identifier('context'),
              types.identifier('locale'),
              false,
              true
            ),
            types.objectExpression([
              types.objectProperty(
                types.identifier('locale'),
                types.memberExpression(types.identifier('context'), types.identifier('locale'))
              ),
            ])
          )
        ),
      ]

  const declarationAST = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('response'),
      types.awaitExpression(
        types.callExpression(types.identifier(resourceImportName), [
          types.objectExpression([
            types.spreadElement(
              types.optionalMemberExpression(
                types.identifier('context'),
                types.identifier('params'),
                false,
                true
              )
            ),
            ...localeAST,
            ...funcParams,
          ]),
        ])
      )
    ),
  ])

  const responseMemberAST = ASTUtils.generateMemberExpressionASTFromPath([
    'response',
    ...ASTUtils.parseValuePath(initialPropsData.exposeAs.valuePath || []),
  ])

  const notFoundAST = types.ifStatement(
    types.unaryExpression('!', responseMemberAST),
    types.blockStatement([
      types.returnStatement(
        types.objectExpression([
          types.objectProperty(types.identifier('notFound'), types.booleanLiteral(true)),
        ])
      ),
    ])
  )

  const returnAST = types.returnStatement(
    types.objectExpression(
      [
        types.objectProperty(
          types.identifier('props'),
          types.objectExpression([
            types.objectProperty(
              types.identifier(
                StringUtils.createStateOrPropStoringValue(initialPropsData.exposeAs.name)
              ),
              responseMemberAST,
              false,
              false
            ),
            types.spreadElement(
              types.optionalMemberExpression(
                types.identifier('response'),
                types.identifier('meta'),
                false,
                true
              )
            ),
          ]),
          false,
          false
        ),
        cachePropertyAST,
      ].filter(Boolean)
    )
  )

  return [
    declarationAST,
    notFoundAST,
    ...computeEntityRedirectAST(initialPropsData, skipI18n),
    returnAST,
  ]
}

/**
 * Entity-level redirect for details pages (`initialPropsData.redirect`): when
 * the fetched row's destination field holds a value, the page answers with an
 * HTTP redirect instead of rendering. Placed AFTER the notFound check (a
 * missing row still 404s) and emitted as an IfStatement wrapping its return —
 * several downstream plugins (`addDynamicSeoPropsToGetStaticProps`, the
 * parallel/inline-fetch plugins) locate the props return via
 * `.find((s) => s.type === 'ReturnStatement')` on the try block, so this must
 * never introduce another top-level ReturnStatement.
 */
const computeEntityRedirectAST = (
  initialPropsData: UIDLInitialPropsData,
  skipI18n?: boolean
): types.Statement[] => {
  const redirect = initialPropsData.redirect
  if (!redirect?.destinationField) {
    return []
  }

  const rowPath = [
    'response',
    ...ASTUtils.parseValuePath(initialPropsData.exposeAs.valuePath || []),
  ]
  const destinationAST = ASTUtils.generateMemberExpressionASTFromPath([
    ...rowPath,
    redirect.destinationField,
  ])

  // const entityRedirectUrl = response?.data?.[0]?.<destinationField>
  const destinationDeclarationAST = types.variableDeclaration('const', [
    types.variableDeclarator(types.identifier('entityRedirectUrl'), destinationAST),
  ])

  // Site-internal destinations must keep the visitor's locale: next.config.js
  // redirects are locale-aware, data-fetching redirects are not, so a `/`
  // destination is prefixed with the active non-default locale by hand.
  const localeAwareDestinationAST = skipI18n
    ? types.identifier('entityRedirectUrl')
    : types.conditionalExpression(
        types.logicalExpression(
          '&&',
          types.logicalExpression(
            '&&',
            types.optionalMemberExpression(
              types.identifier('context'),
              types.identifier('locale'),
              false,
              true
            ),
            types.binaryExpression(
              '!==',
              types.memberExpression(types.identifier('context'), types.identifier('locale')),
              types.optionalMemberExpression(
                types.identifier('context'),
                types.identifier('defaultLocale'),
                false,
                true
              )
            )
          ),
          types.callExpression(
            types.memberExpression(
              types.identifier('entityRedirectUrl'),
              types.identifier('startsWith')
            ),
            [types.stringLiteral('/')]
          )
        ),
        types.templateLiteral(
          [
            types.templateElement({ raw: '/', cooked: '/' }, false),
            types.templateElement({ raw: '', cooked: '' }, false),
            types.templateElement({ raw: '', cooked: '' }, true),
          ],
          [
            types.memberExpression(types.identifier('context'), types.identifier('locale')),
            types.identifier('entityRedirectUrl'),
          ]
        ),
        types.identifier('entityRedirectUrl')
      )

  // statusCode: real 301/302 — `permanent: true/false` would answer 308/307.
  const statusCodeAST = redirect.typeField
    ? types.conditionalExpression(
        types.binaryExpression(
          '===',
          ASTUtils.generateMemberExpressionASTFromPath([...rowPath, redirect.typeField]),
          types.stringLiteral('302')
        ),
        types.numericLiteral(302),
        types.numericLiteral(301)
      )
    : types.numericLiteral(301)

  const redirectReturnAST = types.returnStatement(
    types.objectExpression([
      types.objectProperty(
        types.identifier('redirect'),
        types.objectExpression([
          types.objectProperty(types.identifier('destination'), localeAwareDestinationAST),
          types.objectProperty(types.identifier('statusCode'), statusCodeAST),
        ])
      ),
    ])
  )

  return [
    destinationDeclarationAST,
    types.ifStatement(
      types.identifier('entityRedirectUrl'),
      types.blockStatement([redirectReturnAST])
    ),
  ]
}
