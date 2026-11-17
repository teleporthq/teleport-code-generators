import type { ComponentReadExposure } from '@teleporthq/teleport-types'
import { DataExposure, SessionCookieResolver, TableAccess } from '@teleporthq/teleport-shared'
import { statementRowLimit } from './raw-query'

/** Where the routes live, from the project root. */
export const COMPONENT_STATE_ROUTE_FOLDER: ReadonlyArray<string> = [
  'pages',
  'api',
  'component-state',
]

export interface ComponentStateRouteParams {
  /** The table's module in `utils/data-sources/`, whose `fetchData` runs the statement. */
  moduleFileName: string
  /** The component's own statement, as its author wrote it. */
  statement: string
  /** Who may open a page that renders the component (`DataExposure.componentExposureFor`). */
  exposure: ComponentReadExposure
  /** The roles whose session the table-access helpers trust (`TableAccess.resolveTrustedReaderRoles`). */
  trustedReaderRoles?: string[]
  /** The project has authentication: the session reader checks revocation (absent: it does). */
  withRevocation?: boolean
}

/**
 * The route a COMPONENT reads a state of its own from, when the state is filled
 * by an SQL statement (`pages/api/component-state/<route>.js`).
 *
 * A page's state of the same kind is read by the page's own server-side fetch,
 * `fetchData({ rawQuery }, { as: 'visitor' })`, and handed to the page with its
 * props. A component has no such fetch, and a browser may hand a read route no
 * statement — so the statement is baked here, and the route runs it through
 * that same `fetchData`. What it answers is therefore what a page that renders
 * the component would have been given: the rows a visitor is served, without a
 * hidden column, and nothing of a table a visitor may not read.
 *
 * The request names nothing: no statement, no table, no filter. Only who asks
 * counts. A component has no protection of its own, so the route admits whoever
 * may open a page that renders it — every visitor when one of those pages is
 * open to every visitor, otherwise a session one of them admits, and no browser
 * at all when no page renders the component.
 */
export const generateComponentStateRoute = (params: ComponentStateRouteParams): string => {
  const { exposure } = params
  const pages = exposure.public ? null : exposure.pages
  const needsEntitlement = !!pages && pages.some((page) => page.requiresSubscription === true)
  const rowCap = Math.max(DataExposure.BROWSER_READ_MAX_LIMIT, statementRowLimit(params.statement))
  // pages/api/component-state/: three folders below the root.
  const projectRoot = '../../..'

  return `import dataSourceModule from '${projectRoot}/utils/data-sources/${params.moduleFileName}'

${SessionCookieResolver.generateCommonJsSessionTokenResolverCode(projectRoot, {
  withRevocation: params.withRevocation !== false,
})}
${TableAccess.generateTableAccessHelperCode({
  trustedReaderRoles: params.trustedReaderRoles || [],
  projectRoot,
})}
${needsEntitlement ? DataExposure.generateEntitlementCheckCode() : ''}
// The component's own statement. Nothing of the request reaches it.
var STATEMENT = ${JSON.stringify(params.statement)}
// What each page that renders the component demands of a session — null when
// every visitor may open one of them, an empty list when no page renders it.
var COMPONENT_PAGES = ${JSON.stringify(
    pages
      ? pages.map((page) => ({
          allowedRoles: page.allowedRoles || [],
          requiresSubscription: page.requiresSubscription === true,
          subscriptionProductIds: page.subscriptionProductIds || [],
        }))
      : null
  )}
// Every one of those pages reads its own data as the store; so does this.
var READS_AS_STORE = ${JSON.stringify(!exposure.public && exposure.readsAsStore === true)}
var ROW_CAP = ${rowCap}

// null when the caller may read, else { status, message }: the app's own server
// code, every visitor of a component on a page open to all, or a session one of
// the component's pages admits.
async function guardCaller(req) {
  if (__taIsInternalRequest(req)) return null
  if (!COMPONENT_PAGES) return null
  var token = null
  try {
    token = await __tqSessionToken(req)
  } catch (e) {
    token = null
  }
  if (!token) return { status: 401, message: 'Unauthenticated' }
  var role = __taRoleOf(token)
  for (var i = 0; i < COMPONENT_PAGES.length; i++) {
    var page = COMPONENT_PAGES[i]
    if (page.allowedRoles.length > 0 && (!role || page.allowedRoles.indexOf(role) === -1)) continue
    if (page.requiresSubscription && !(await __dxEntitled(token, page.subscriptionProductIds))) continue
    return null
  }
  return { status: 403, message: 'Forbidden' }
}

export default async function handler(req, res) {
  try {
    const __denied = await guardCaller(req)
    if (__denied) {
      return res.status(__denied.status).json({ success: false, error: __denied.message, timestamp: Date.now() })
    }

    const data = await dataSourceModule.fetchData(
      { rawQuery: STATEMENT },
      READS_AS_STORE ? {} : { as: 'visitor' }
    )

    return res.status(200).json({
      success: true,
      data: Array.isArray(data) ? data.slice(0, ROW_CAP) : data,
      timestamp: Date.now()
    })
  } catch (error) {
    // The error names tables, columns and values: server log only, under the
    // reference the client gets.
    const id = Math.floor(Math.random() * 0xffffffff).toString(16)
    console.error('Component state fetch error (' + id + '):', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch data',
      id: id,
      timestamp: Date.now()
    })
  }
}
`
}
