import * as types from '@babel/types'
import type { UIDLDependency } from '@teleporthq/teleport-types'

/**
 * How a generated data-source fetch says which language it is for.
 *
 * A multi-language project stores a translatable column once per language
 * (`name`, `es_name`, …) and the generated fetcher resolves each row against
 * ONE of them (see `transformations/` and `localized-columns.ts`). Nothing
 * about the API route knows the page it serves — an API route has no locale
 * segment in its URL — so the page tells it, through this query parameter:
 *
 *   - a client-side fetch (`DataProvider` `params`) sends `router.locale`;
 *   - a build-time fetch inside `getStaticProps` sends `context.locale`.
 *
 * Both are what Next.js resolved from the `/es/...` route, so the rows a page
 * renders are in the language the page is in. The same name the details-page
 * fetch (`teleport-plugin-next-static-props`) has always sent.
 */
export const REQUEST_LOCALE_PARAM = 'locale'

/** The dependency behind the `router` every client-side locale read closes over. */
const USE_ROUTER_DEPENDENCY: UIDLDependency = {
  type: 'library',
  path: 'next/router',
  version: '^12.1.10',
  meta: { namedImport: true },
}

/**
 * `router?.locale` — the client's current locale. Optional-chained like every
 * other generated `router` read: `useRouter()` answers `null` during a static
 * export's first paint.
 */
export const buildClientLocaleExpression = (): types.Expression =>
  types.optionalMemberExpression(
    types.identifier('router'),
    types.identifier('locale'),
    false,
    true
  )

/** `locale: router?.locale` — the param of a client-side fetch. */
export const buildClientLocaleParam = (): types.ObjectProperty =>
  types.objectProperty(types.identifier(REQUEST_LOCALE_PARAM), buildClientLocaleExpression())

/** `locale: context.locale` — the param of a fetch inside getStaticProps. */
export const buildServerLocaleParam = (): types.ObjectProperty =>
  types.objectProperty(
    types.identifier(REQUEST_LOCALE_PARAM),
    types.memberExpression(types.identifier('context'), types.identifier('locale'))
  )

/** Whether an object literal already carries the locale param. */
export const hasLocaleParam = (properties: types.ObjectExpression['properties']): boolean =>
  properties.some(
    (property) =>
      property.type === 'ObjectProperty' &&
      ((property.key.type === 'Identifier' && property.key.name === REQUEST_LOCALE_PARAM) ||
        (property.key.type === 'StringLiteral' && property.key.value === REQUEST_LOCALE_PARAM))
  )

/**
 * Adds the client locale to a fetch's params, once, and to the `useMemo` deps
 * that must rebuild them: a locale switch is a client-side transition on the
 * SAME page instance, so only a dependency change refetches the rows in the
 * new language.
 */
export const appendClientLocaleParam = (
  paramsProps: types.ObjectExpression['properties'],
  memoDeps: types.Expression[]
): void => {
  if (!hasLocaleParam(paramsProps)) {
    paramsProps.push(buildClientLocaleParam())
  }
  memoDeps.push(buildClientLocaleExpression())
}

/** Any declaration of `router` — a second one, however it is initialised, is a syntax error. */
const declaresRouter = (statement: types.Statement): boolean =>
  statement.type === 'VariableDeclaration' &&
  statement.declarations.some(
    (declaration) => declaration.id.type === 'Identifier' && declaration.id.name === 'router'
  )

/**
 * Puts `const router = useRouter()` (and its import) in scope, once.
 *
 * Idempotent with every sibling plugin that declares the same hook — the i18n
 * locale mapper, the URL search-params plugin and the base component plugin
 * all guard on the same identifier, so whichever runs first wins and the rest
 * find it in place. Unshifted to the top of the body: nothing reads it before
 * an effect runs, and hooks must not sit below a conditional return.
 */
export const ensureRouterDeclaration = (
  body: types.Statement[],
  dependencies: Record<string, UIDLDependency>
): void => {
  if (!dependencies.useRouter) {
    dependencies.useRouter = { ...USE_ROUTER_DEPENDENCY }
  }
  if (body.some(declaresRouter)) {
    return
  }
  body.unshift(
    types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier('router'),
        types.callExpression(types.identifier('useRouter'), [])
      ),
    ])
  )
}
