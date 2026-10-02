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

  const revalidateSeconds = resolveRevalidateSeconds(
    initialPropsData,
    globalCache,
    useServerSideProps
  )

  const functionContentAST = types.blockStatement([
    paramsDestructureAST,
    types.tryStatement(
      types.blockStatement([
        ...computePropsAST(
          initialPropsData,
          resourceImportName,
          revalidateSeconds,
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
          // A fetch that FAILED is not a row that does not exist: without
          // `revalidate` the 404 is cached for good, so one timeout or rate
          // limit — every details page calls its source while the site builds —
          // left that record unreachable until the next deploy.
          types.returnStatement(
            types.objectExpression(
              [
                types.objectProperty(types.identifier('notFound'), types.booleanLiteral(true)),
                buildRevalidateProperty(revalidateSeconds),
              ].filter(Boolean)
            )
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
const resolveRevalidateSeconds = (
  initialPropsData: UIDLInitialPropsData,
  globalCache: UIDLResources['cache'],
  useServerSideProps?: boolean
): number | null => {
  // getServerSideProps re-runs on every request — there is no revalidate
  // window to configure, and Next.js errors if the prop is present.
  if (useServerSideProps) {
    return null
  }

  const perPageCache = initialPropsData.cache
  if (perPageCache?.revalidate) {
    return perPageCache.revalidate
  }

  return globalCache?.revalidate || null
}

/** A FRESH `revalidate` node for one return, or null when there is no window. */
const buildRevalidateProperty = (revalidateSeconds: number | null): types.ObjectProperty | null =>
  revalidateSeconds === null
    ? null
    : types.objectProperty(types.identifier('revalidate'), types.numericLiteral(revalidateSeconds))

const computePropsAST = (
  initialPropsData: UIDLInitialPropsData,
  resourceImportName: string,
  revalidateSeconds: number | null,
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
    A FRESH node per return: `revalidate` belongs on every branch of
    getStaticProps, not only the one that renders.

    `notFound` and `redirect` are cached exactly like props are, and a branch
    that omits `revalidate` is cached with no expiry at all — Next.js never
    re-runs getStaticProps for it. A page that redirected once then redirects
    for ever: clearing `redirect_url` in the admin changes the database and
    changes nothing a visitor sees, because the ISR entry is never revisited.
    The same freeze turns an unpublished row's 404 permanent, so publishing it
    later has no effect either.

    On-demand revalidation (the `page-revalidate` node the admin's save runs)
    is what makes the change appear immediately; this is the floor it falls
    back to when that call cannot be made or fails, and the reason a redirect
    is never permanent by accident.
  */
  const revalidateProperty = (): types.ObjectProperty | null =>
    buildRevalidateProperty(revalidateSeconds)

  // The locale tells a localized data source which language to resolve the
  // row into (`es_name` for `es`). A page that WRITES the row it fetched — the
  // getServerSideProps branch, see `useServerSideProps` — must not have it
  // resolved: its form binds the stored per-language columns themselves, and a
  // main-language field seeded with the Spanish copy would save Spanish into
  // the main column. Such a page fetches the row as stored.
  const localeAST =
    skipI18n || useServerSideProps
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

  // The resource call, with its `filters` param replaced when asked.
  const fetchCallAST = (filtersOverride?: types.Expression): types.AwaitExpression =>
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
          ...localeAST.map((spread) => types.cloneNode(spread, true)),
          ...funcParams.map((param) =>
            filtersOverride && (param.key as types.StringLiteral).value === 'filters'
              ? types.objectProperty(types.stringLiteral('filters'), filtersOverride)
              : types.cloneNode(param, true)
          ),
        ]),
      ])
    )

  const declarationAST = types.variableDeclaration('const', [
    types.variableDeclarator(types.identifier('response'), fetchCallAST()),
  ])

  const responseMemberAST = ASTUtils.generateMemberExpressionASTFromPath([
    'response',
    ...ASTUtils.parseValuePath(initialPropsData.exposeAs.valuePath || []),
  ])

  const notFoundAST = types.ifStatement(
    types.unaryExpression('!', responseMemberAST),
    types.blockStatement([
      types.returnStatement(
        types.objectExpression(
          [
            types.objectProperty(types.identifier('notFound'), types.booleanLiteral(true)),
            revalidateProperty(),
          ].filter(Boolean)
        )
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
        revalidateProperty(),
      ].filter(Boolean)
    )
  )

  return [
    declarationAST,
    notFoundAST,
    ...computeOwnRowPreferenceAST(initialPropsData, funcParams, fetchCallAST),
    ...computeEntityRedirectAST(initialPropsData, skipI18n, revalidateProperty),
    ...computeOmitFieldsAST(initialPropsData),
    returnAST,
  ]
}

/**
 * `initialPropsData.omitFields` taken off the fetched row before the props are
 * returned — after the redirect, which may read them. A statement that is
 * never a ReturnStatement, so the plugins that look for the props return still
 * find the one.
 *
 *   const rowWithOmittedFields = response?.data?.[0]
 *   if (rowWithOmittedFields && typeof rowWithOmittedFields === 'object') {
 *     delete rowWithOmittedFields['online_url']
 *   }
 */
const computeOmitFieldsAST = (initialPropsData: UIDLInitialPropsData): types.Statement[] => {
  const fields = (initialPropsData.omitFields || []).filter(
    (field) => typeof field === 'string' && field.length > 0
  )
  if (fields.length === 0) {
    return []
  }
  const rowName = 'rowWithOmittedFields'
  return [
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier(rowName),
        ASTUtils.generateMemberExpressionASTFromPath([
          'response',
          ...ASTUtils.parseValuePath(initialPropsData.exposeAs.valuePath || []),
        ])
      ),
    ]),
    types.ifStatement(
      types.logicalExpression(
        '&&',
        types.identifier(rowName),
        types.binaryExpression(
          '===',
          types.unaryExpression('typeof', types.identifier(rowName)),
          types.stringLiteral('object')
        )
      ),
      types.blockStatement(
        fields.map((field) =>
          types.expressionStatement(
            types.unaryExpression(
              'delete',
              types.memberExpression(types.identifier(rowName), types.stringLiteral(field), true)
            )
          )
        )
      )
    ),
  ]
}

/**
 * A page that shows a SUBSET of a table's rows (`redirect.unlessFieldEquals`)
 * and names the filter selecting its own rows (`redirect.ownRowsFilter`): two
 * rows can share an address — two products with one slug on different
 * product pages. When the row found belongs to another page, an own row at
 * the same address is fetched and shown instead, so the page redirects only
 * when it has none (and never while pre-rendering the paths it lists itself,
 * which Next.js refuses and fails the build on).
 *
 *   if (String(response?.data?.[0]?.<field> ?? '') !== '<value>') {
 *     const ownRowsResponse = await <resource>({ ...same params,
 *       filters: JSON.stringify(JSON.parse(<filters>).concat(<ownRowsFilter>)) })
 *     if (ownRowsResponse?.data?.[0]) {
 *       response.data = ownRowsResponse.data
 *     }
 *   }
 *
 * `response` itself stays the one declaration later plugins find; only the
 * rows inside it are swapped.
 */
const computeOwnRowPreferenceAST = (
  initialPropsData: UIDLInitialPropsData,
  funcParams: types.ObjectProperty[],
  fetchCallAST: (filtersOverride?: types.Expression) => types.AwaitExpression
): types.Statement[] => {
  const redirect = initialPropsData.redirect
  const guard = redirect?.unlessFieldEquals
  const ownRowsFilter = redirect?.ownRowsFilter
  const valuePath = initialPropsData.exposeAs.valuePath || []
  const filtersParam = funcParams.find(
    (param) => (param.key as types.StringLiteral).value === 'filters'
  )
  // The rows sit one level above the row (`data` of `data.0`); a row that IS
  // the response cannot be swapped.
  if (!guard || !ownRowsFilter?.length || !filtersParam || valuePath.length < 2) {
    return []
  }

  const rowsPath = valuePath.slice(0, -1)
  const assignablePath = (root: string): types.MemberExpression | types.Identifier =>
    rowsPath.reduce<types.MemberExpression | types.Identifier>(
      (object, segment) =>
        /^\d+$/.test(segment)
          ? types.memberExpression(object, types.numericLiteral(Number(segment)), true)
          : types.memberExpression(object, types.identifier(segment)),
      types.identifier(root)
    )
  const ownRowAST = ASTUtils.generateMemberExpressionASTFromPath([
    'ownRowsResponse',
    ...ASTUtils.parseValuePath(valuePath),
  ])
  const combinedFiltersAST = types.callExpression(
    types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
    [
      types.callExpression(
        types.memberExpression(
          types.callExpression(
            types.memberExpression(types.identifier('JSON'), types.identifier('parse')),
            [types.cloneNode(filtersParam.value as types.Expression, true)]
          ),
          types.identifier('concat')
        ),
        [types.valueToNode(ownRowsFilter)]
      ),
    ]
  )

  return [
    types.ifStatement(
      types.binaryExpression(
        '!==',
        types.callExpression(types.identifier('String'), [
          types.logicalExpression(
            '??',
            ASTUtils.generateMemberExpressionASTFromPath([
              'response',
              ...ASTUtils.parseValuePath(valuePath),
              guard.field,
            ]),
            types.stringLiteral('')
          ),
        ]),
        types.stringLiteral(guard.value)
      ),
      types.blockStatement([
        types.variableDeclaration('const', [
          types.variableDeclarator(
            types.identifier('ownRowsResponse'),
            fetchCallAST(combinedFiltersAST)
          ),
        ]),
        types.ifStatement(
          ownRowAST,
          types.blockStatement([
            types.expressionStatement(
              types.assignmentExpression(
                '=',
                assignablePath('response'),
                assignablePath('ownRowsResponse')
              )
            ),
          ])
        ),
      ])
    ),
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
  skipI18n: boolean | undefined,
  revalidateProperty: () => types.ObjectProperty | null
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
  // …or, when the page shows a SUBSET of the table's rows (`unlessFieldEquals`):
  // const entityRedirectUrl =
  //   String(response?.data?.[0]?.<field> ?? '') !== '<value>'
  //     ? response?.data?.[0]?.<destinationField>
  //     : undefined
  const guard = redirect.unlessFieldEquals
  const destinationDeclarationAST = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('entityRedirectUrl'),
      guard
        ? types.conditionalExpression(
            types.binaryExpression(
              '!==',
              types.callExpression(types.identifier('String'), [
                types.logicalExpression(
                  '??',
                  ASTUtils.generateMemberExpressionASTFromPath([...rowPath, guard.field]),
                  types.stringLiteral('')
                ),
              ]),
              types.stringLiteral(guard.value)
            ),
            destinationAST,
            types.identifier('undefined')
          )
        : destinationAST
    ),
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
    : types.numericLiteral(redirect.statusCode ?? 301)

  const redirectReturnAST = types.returnStatement(
    types.objectExpression(
      [
        types.objectProperty(
          types.identifier('redirect'),
          types.objectExpression([
            types.objectProperty(types.identifier('destination'), localeAwareDestinationAST),
            types.objectProperty(types.identifier('statusCode'), statusCodeAST),
          ])
        ),
        // Without this the redirect is cached with no expiry — see
        // `revalidateProperty`. A redirect an editor can switch off must not
        // outlive the row that asked for it.
        revalidateProperty(),
      ].filter(Boolean)
    )
  )

  // Next.js fails the whole build on a redirect while pre-rendering. A page
  // showing a subset of the rows lists only its own in its paths, so this is a
  // safety net: the path answers 404 until its revalidate window, then redirects.
  const buildPhaseNotFoundAST = guard
    ? [
        types.ifStatement(
          types.binaryExpression(
            '===',
            types.memberExpression(
              types.memberExpression(types.identifier('process'), types.identifier('env')),
              types.identifier('NEXT_PHASE')
            ),
            types.stringLiteral('phase-production-build')
          ),
          types.blockStatement([
            types.returnStatement(
              types.objectExpression(
                [
                  types.objectProperty(types.identifier('notFound'), types.booleanLiteral(true)),
                  revalidateProperty(),
                ].filter(Boolean)
              )
            ),
          ])
        ),
      ]
    : []

  return [
    destinationDeclarationAST,
    types.ifStatement(
      types.identifier('entityRedirectUrl'),
      types.blockStatement([...buildPhaseNotFoundAST, redirectReturnAST])
    ),
  ]
}
