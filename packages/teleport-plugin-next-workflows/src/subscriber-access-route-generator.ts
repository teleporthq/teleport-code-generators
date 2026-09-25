/**
 * Subscriber-only pages: the entitlement check a generated store runs for a
 * page whose protection carries `requiresSubscription`.
 *
 * Two files, emitted together whenever at least one page is subscriber-only:
 *
 *  - `utils/auth/subscriber-access.js` — the ONE parameterised query that
 *    decides entitlement (`SUBSCRIPTION_ENTITLEMENT_SQL` from teleport-shared,
 *    statuses baked from `SUBSCRIPTION_ENTITLED_STATUSES`) plus the lookup of
 *    the storefront page of the first product a page names. Shared by the
 *    route below and by the workflow-route guard (`workflow-auth.js`), so the
 *    middleware and a page's workflow routes can never disagree.
 *  - `pages/api/auth/subscriber-access.js` — what the Edge middleware asks
 *    (it has no database): `GET ?products=<comma ids>` with the visitor's
 *    cookie forwarded → 401 without a session, else
 *    `{ entitled: boolean, redirectTo?: string }`, never cached.
 *
 * The middleware itself lives in `auth-generator.ts` (`generateMiddlewareFile`).
 */
import { ProjectUIDL, UIDLAuthentication } from '@teleporthq/teleport-types'
import { SubscriptionAccess } from '@teleporthq/teleport-shared'
import { generatePgClientCode } from './pg-client-code'
import { generateCommonJsSessionTokenResolverCode } from './session-cookie-resolver'

const PRODUCTS_TABLE = 'teleport_products'
const MAX_PRODUCT_IDS = 50
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Where the storefront serves a single product from, read off the UIDL's route table. */
export interface ProductDetailsRoute {
  // `/products` for a page emitted at `/products/[slug]`; `/` when the details
  // page sits at the root.
  staticBase: string
  // The product column the dynamic segment carries (`slug`, `id`).
  differentiatorColumn: string
}

export const hasSubscriberOnlyPages = (auth: UIDLAuthentication | undefined): boolean => {
  if (!auth || !auth.pageProtection) {
    return false
  }
  return Object.values(auth.pageProtection).some(
    (protection) => !!protection && protection.requiresSubscription === true
  )
}

const routeValuesOf = (uidl: ProjectUIDL | undefined): any[] => {
  const values = (uidl as any)?.root?.stateDefinitions?.route?.values
  return Array.isArray(values) ? values : []
}

/**
 * The product-details page: the route value whose `detailsPageInfo` reads the
 * products table. Its `navLink` is `<base>/[<column>]`; the base is what the
 * list page shares with it by platform convention.
 */
export const resolveProductDetailsRoute = (
  uidl: ProjectUIDL | undefined
): ProductDetailsRoute | null => {
  for (const routeValue of routeValuesOf(uidl)) {
    const pageOptions = routeValue?.pageOptions
    const info = pageOptions?.detailsPageInfo
    if (!info || String(info.tableName || '').toLowerCase() !== PRODUCTS_TABLE) {
      continue
    }
    const navLink = String(pageOptions.navLink || '')
    const column = String(info.differentiatorColumn || pageOptions.dynamicRouteAttribute || '')
    if (!navLink.startsWith('/') || !IDENTIFIER_RE.test(column)) {
      continue
    }
    const staticBase = navLink.replace(/\/\[[^\]]*\]$/, '') || '/'
    return { staticBase, differentiatorColumn: column }
  }
  return null
}

/**
 * Where the middleware sends a visitor who lacks the subscription when the
 * route could name no product page: the products listing when the store has
 * one (a page served at the details page's static base), else the home page.
 */
export const resolveSubscriptionFallbackRoute = (uidl: ProjectUIDL | undefined): string => {
  const details = resolveProductDetailsRoute(uidl)
  if (!details || details.staticBase === '/') {
    return '/'
  }
  const hasListing = routeValuesOf(uidl).some(
    (routeValue) => String(routeValue?.pageOptions?.navLink || '') === details.staticBase
  )
  return hasListing ? details.staticBase : '/'
}

export interface SubscriberAccessHelperOptions {
  productDetails: ProductDetailsRoute | null
}

/**
 * `utils/auth/subscriber-access.js` (CommonJS). Exports:
 *  - `normalizeProductIds(value)` — trimmed, de-duplicated ids from an array
 *    or a comma-separated string, capped.
 *  - `isSubscriberEntitled(userId, productIds)` — the entitlement query; an
 *    empty list means any product. Throws on a database failure so a caller
 *    can fail closed on its own terms.
 *  - `resolveProductRedirect(productIds)` — the storefront page of the FIRST
 *    product, or null (no product page, unknown product, database failure).
 */
export const generateSubscriberAccessHelperModule = (
  options: SubscriberAccessHelperOptions
): string => {
  const details =
    options.productDetails && IDENTIFIER_RE.test(options.productDetails.differentiatorColumn)
      ? options.productDetails
      : null

  return `'use strict';

// GENERATED — see generateSubscriberAccessHelperModule in
// @teleporthq/teleport-plugin-next-workflows/src/subscriber-access-route-generator.ts.
//
// Whether a signed-in visitor holds an entitled subscription: the one query the
// subscriber-access route (for the middleware) and the workflow-route guard
// share, so a page and its workflows can never disagree about who may read.
${generatePgClientCode()}

var SUBSCRIPTION_ENTITLED_STATUSES = ${JSON.stringify(
    SubscriptionAccess.SUBSCRIPTION_ENTITLED_STATUSES
  )};
var ENTITLEMENT_SQL = ${JSON.stringify(SubscriptionAccess.SUBSCRIPTION_ENTITLEMENT_SQL)};
var MAX_PRODUCT_IDS = ${MAX_PRODUCT_IDS};
// The product-details page, when the store has one: its static base and the
// product column its dynamic segment carries.
var PRODUCT_DETAILS = ${JSON.stringify(details)};
var PRODUCTS_TABLE = ${JSON.stringify(PRODUCTS_TABLE)};

function normalizeProductIds(value) {
  var raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  var ids = [];
  for (var i = 0; i < raw.length && ids.length < MAX_PRODUCT_IDS; i++) {
    var id = String(raw[i] == null ? '' : raw[i]).trim();
    if (id && ids.indexOf(id) === -1) {
      ids.push(id);
    }
  }
  return ids;
}

async function withClient(run) {
  var client = getClient();
  try {
    await client.connect();
    return await run(client);
  } finally {
    try { await client.end(); } catch (e) {}
  }
}

// true when the user holds a subscription in an entitled status to one of the
// products — to any product when the list is empty.
async function isSubscriberEntitled(userId, productIds) {
  var id = String(userId == null ? '' : userId).trim();
  if (!id) {
    return false;
  }
  var ids = normalizeProductIds(productIds);
  return withClient(async function (client) {
    var result = await client.query(ENTITLEMENT_SQL, [id, SUBSCRIPTION_ENTITLED_STATUSES, ids]);
    return !!(result && result.rows && result.rows.length > 0);
  });
}

// The storefront page of the first product a page names, or null.
async function resolveProductRedirect(productIds) {
  var ids = normalizeProductIds(productIds);
  if (!PRODUCT_DETAILS || ids.length === 0) {
    return null;
  }
  try {
    return await withClient(async function (client) {
      var result = await client.query(
        'SELECT "' + PRODUCT_DETAILS.differentiatorColumn + '" AS value FROM ' + PRODUCTS_TABLE + ' WHERE id::text = $1 LIMIT 1',
        [ids[0]]
      );
      var value = result && result.rows && result.rows[0] ? result.rows[0].value : null;
      if (value == null || String(value) === '') {
        return null;
      }
      var base = PRODUCT_DETAILS.staticBase === '/' ? '' : PRODUCT_DETAILS.staticBase;
      return base + '/' + encodeURIComponent(String(value));
    });
  } catch (e) {
    return null;
  }
}

module.exports = {
  SUBSCRIPTION_ENTITLED_STATUSES: SUBSCRIPTION_ENTITLED_STATUSES,
  normalizeProductIds: normalizeProductIds,
  isSubscriberEntitled: isSubscriberEntitled,
  resolveProductRedirect: resolveProductRedirect,
};
`
}

/**
 * `pages/api/auth/subscriber-access.js`: GET only, the session read from the
 * forwarded cookie exactly as the workflow routes read it, then the shared
 * helper. A failed query answers 500 — the middleware treats anything but an
 * `entitled: true` body as "not entitled", so the page fails closed.
 */
export const generateSubscriberAccessRoute = (): string => {
  return `'use strict';

// GENERATED — see generateSubscriberAccessRoute in
// @teleporthq/teleport-plugin-next-workflows/src/subscriber-access-route-generator.ts.
//
// Asked by the middleware for a subscriber-only page: does the visitor behind
// this cookie hold an entitled subscription to one of ?products (any, when
// none are named)? Never cached — a subscription can end between two requests.
${generateCommonJsSessionTokenResolverCode()}
var __subscriberAccess = require('../../../utils/auth/subscriber-access');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var token = null;
  try {
    token = await __tqSessionToken(req);
  } catch (e) {
    token = null;
  }
  var userId = token && (token.id != null ? token.id : token.sub);
  if (userId == null || String(userId) === '') {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  var productIds = __subscriberAccess.normalizeProductIds(req.query && req.query.products);
  var entitled = false;
  try {
    entitled = await __subscriberAccess.isSubscriberEntitled(String(userId), productIds);
  } catch (e) {
    console.error('[subscriber-access] entitlement check failed:', e && e.message ? e.message : e);
    return res.status(500).json({ error: 'Subscription check failed' });
  }
  if (entitled) {
    return res.status(200).json({ entitled: true });
  }

  var body = { entitled: false };
  var redirectTo = await __subscriberAccess.resolveProductRedirect(productIds);
  if (redirectTo) {
    body.redirectTo = redirectTo;
  }
  return res.status(200).json(body);
};
`
}
