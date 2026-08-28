import {
  ComponentPlugin,
  ComponentPluginFactory,
  ChunkType,
  FileType,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { parseExpression } from '@babel/parser'
import { ASTStatementOrder, StringUtils } from '@teleporthq/teleport-shared'
import { ASTUtils, URLSearchParamSync } from '@teleporthq/teleport-plugin-common'
import { generateSafeFileName } from './utils'
import { generateDataSourceFetcherWithCore } from './data-source-fetchers'
import {
  buildProductTransformOptions,
  type EcommerceProductTransformOptions,
} from './transformations'
import { appendSortsParam, DynamicSortAST, extractDynamicSort } from './sort-utils'
import { appendFiltersParam, pushStateIdsAsDeps, pushPropIdsAsDeps } from './filter-utils'
import {
  applyLoadingStateToDataProvider,
  buildLoadingStateDeclarations,
  getLoadingStateVars,
} from './loading-state'
import type { DataSourceServerCacheOptions, ResolvedDataSourceCache } from './cache/types'
import { mergeServerCacheOptions, resolveCacheFromRepeaterContent } from './cache/config'
import {
  buildCacheHydrationEffect,
  buildCacheStoreThen,
  buildCachedFetchBody,
  buildCachedParamsDeclarations,
  registerCacheClientImports,
} from './cache/ast'

// ----- searchDefaultValue support -----
//
// `searchDefaultValue` on a `cms-list-repeater` UIDL node seeds the
// generated search input and the pre-debounce combined state. UIDL
// stores the attribute as either `{type:'static',content:string}` (a
// hard-coded initial value) or `{type:'expr',content:string}` (a JS
// expression referencing props / state / router query / a URL param
// helper). Static strings become `types.stringLiteral(...)` and
// expressions are parsed via `@babel/parser.parseExpression` into a
// real AST node we slot straight into `useState(...)`.
type SearchDefaultValue =
  | { kind: 'static'; value: string }
  | { kind: 'expression'; ast: types.Expression }

// tslint:disable-next-line:no-any
function parseSearchDefaultValue(raw: any): SearchDefaultValue | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  if (raw.type === 'static' && typeof raw.content === 'string' && raw.content.length > 0) {
    return { kind: 'static', value: raw.content }
  }
  if ((raw.type === 'expr' || raw.type === 'dynamic') && typeof raw.content === 'string') {
    const src = raw.content.trim()
    if (src.length === 0) {
      return undefined
    }
    try {
      const ast = parseExpression(src, { sourceType: 'module', plugins: ['jsx'] })
      return { kind: 'expression', ast: ast as types.Expression }
    } catch {
      // Fall back to no seed if the expression is malformed — better to
      // render an empty input than to emit broken code.
      return undefined
    }
  }
  return undefined
}

function searchDefaultValueInitAST(value: SearchDefaultValue | undefined): types.Expression {
  if (!value) {
    return types.stringLiteral('')
  }
  if (value.kind === 'static') {
    return types.stringLiteral(value.value)
  }
  // Clone so multiple `useState(...)` call sites each get an
  // independent AST node — Babel does not support shared references.
  return types.cloneNode(value.ast, /* deep */ true) as types.Expression
}

// Builds the `useState(...)` initializer for the search query. When the
// cms-list-repeater is bound to a URL param (`searchUrlParamKey`), the query is
// seeded from `window.location.search` on the client so a deep link such as
// `/products-list?searchKeyword=yoga` arrives pre-filtered on the very first
// paint; the server render (where `window` is undefined) and any missing param
// fall back to the `searchDefaultValue` seed (empty string by default). This
// mirrors the `selectedCategory` / `sortBy` initializer emitted by
// `createStateHookAST` for state-level `urlSearchParamBinding`, keeping the
// three products-list controls consistent.
//
// Returns a fresh AST on every call (no shared node references) so the same
// initializer can seed both the immediate `ds_N_searchQuery` state and the
// debounced `ds_N_state.debouncedQuery` value.
function buildSearchQueryInitAST(usage: DataSourceUsage): types.Expression {
  const fallback = searchDefaultValueInitAST(usage.searchDefaultValue)
  if (!usage.searchUrlParamKey) {
    return fallback
  }
  // (typeof window !== 'undefined'
  //   ? new URLSearchParams(window.location.search).get('<key>')
  //   : null) ?? <fallback>
  return types.logicalExpression(
    '??',
    types.conditionalExpression(
      types.binaryExpression(
        '!==',
        types.unaryExpression('typeof', types.identifier('window')),
        types.stringLiteral('undefined')
      ),
      types.callExpression(
        types.memberExpression(
          types.newExpression(types.identifier('URLSearchParams'), [
            types.memberExpression(
              types.memberExpression(types.identifier('window'), types.identifier('location')),
              types.identifier('search')
            ),
          ]),
          types.identifier('get')
        ),
        [types.stringLiteral(usage.searchUrlParamKey)]
      ),
      types.nullLiteral()
    ),
    fallback
  )
}

// ==================== UIDL-FIRST STATE MANAGEMENT ====================
// This module uses a UIDL-first approach: we scan the UIDL FIRST to identify
// ALL data source usages and assign unique state IDs BEFORE any JSX processing.
// This ensures consistent state mapping across DataProviders, search inputs, and pagination buttons.

interface DataSourceUsage {
  // Unique sequential index for this usage (0, 1, 2, ...)
  index: number
  // The data-source-list renderPropIdentifier (e.g., "dsadsa3_users_data")
  dataSourceIdentifier: string
  // The cms-list-repeater renderPropIdentifier (e.g., "context_1i871")
  arrayMapperRenderProp: string
  // Resource definition from UIDL
  resourceDefinition: {
    dataSourceId: string
    tableName: string
    dataSourceType: string
  }
  // Pagination config
  paginated: boolean
  perPage: number
  // Search config
  searchEnabled: boolean
  searchDebounce: number
  // Initial value for the search input. Static strings are seeded as
  // `useState(<string>)`; dynamic UIDL expressions are parsed via
  // `@babel/parser` and slotted in as real AST nodes so the generated
  // component can reference props / state / router-query / URL-param
  // helpers in the initial value.
  searchDefaultValue?: SearchDefaultValue
  // URL query-param key the search input is two-way bound to (e.g.
  // `'searchKeyword'`). When present, the generated component seeds the search
  // query from `window.location.search`, mirrors browser navigation back into
  // the input (read-back), and pushes the debounced query onto the URL
  // (write-back) via the shared `URLSearchParamSync` builders — the same
  // loop-free mechanism the `selectedCategory` / `sortBy` dropdowns use.
  searchUrlParamKey?: string
  // Query columns from resource params
  queryColumns: string[]
  // Sorts from resource params (legacy static-array form)
  // tslint:disable-next-line:no-any
  sorts: any[]
  // Dynamic single-column sort bound to component state (set when legacy sorts empty
  // and cms-list-repeater declares sort/sortDirection fields)
  dynamicSort?: DynamicSortAST
  // Filters from resource params (FLAT condition array — any `{ type: 'group',
  // children: [...] }` wrappers from the UIDL inspector have already been
  // unwrapped via `flattenFilterGroups`). Downstream emit sites rely on
  // entries having `.source` / `.destination` / `.operand` directly.
  // tslint:disable-next-line:no-any
  filters: any[]
  // State IDs from dynamic filter destinations (for useMemo dependencies).
  // Only `state` references land here; their dep/guard expression is a bare
  // identifier. `prop` refs go to `filterPropIds` (dep expression `props.<id>`)
  // and `urlSearchParams` refs to `filterUrlSearchParamKeys` (dep expression
  // `router.query.<key>`), because each resolves to a different scope.
  filterStateIds: string[]
  // Prop IDs from dynamic filter destinations. Kept separate from
  // `filterStateIds` so their dep/guard expression is `props.<id>` (matching the
  // VALUE side in `convertFilterDestinationToExpression`) rather than a bare
  // identifier — a bare `<id>` is undefined in the component scope and crashes
  // prerender with `ReferenceError: <id> is not defined`.
  filterPropIds: string[]
  // URL search-param keys referenced by filter destinations (e.g.
  // `'categoryFilter'`). Drives `const router = useRouter()` injection and
  // the corresponding `router.query.<key>` entries in `useMemo` deps so the
  // client-side fetch refires when the buyer navigates between
  // `?categoryFilter=Rings` and `?categoryFilter=Necklaces`.
  filterUrlSearchParamKeys: string[]
  // Resolved caching setup for this mapper, or `undefined` when it does not
  // cache — in which case every emit site below must produce exactly what it
  // produced before caching existed.
  cache?: ResolvedDataSourceCache
  // Computed category
  category: 'paginated+search' | 'paginated-only' | 'search-only' | 'plain'
}

interface StateRegistry {
  usages: DataSourceUsage[]
  // Map from dataSourceIdentifier to all usages with that identifier
  byDataSourceId: Map<string, DataSourceUsage[]>
  // Map from arrayMapperRenderProp to usage
  byArrayMapperRenderProp: Map<string, DataSourceUsage>
}

// The UIDL's `filters.content` array can wrap one or more conditions inside
// a `{ type: 'group', operator: 'and' | 'or', children: [...] }` entry — the
// GUI builds this shape when the inspector adds a logical group. The data
// source API endpoint (`processFilters` in the generated data-source module)
// only knows how to consume a FLAT array of `{ source, destination, operand }`
// conditions, so we walk groups recursively here and collect their leaf
// conditions in order. Anything that isn't a group AND isn't a condition is
// dropped — defensive against partially-built filter entries that would
// otherwise emit `{ source: '', destination: '', operand: '' }` rows the
// API ignores anyway.
//
// `or`-grouped conditions are flattened just like `and`-grouped ones — the
// downstream SQL builder always joins flat filters with `AND`, so emitting
// the conditions side-by-side approximates AND semantics. A future API
// upgrade that respects group operators would key off the original tree
// directly; until then, AND-flattening is the closest correct behaviour and
// matches what the inspector preview shows for the common single-group case
// the GUI emits today.
function flattenFilterGroups(filters: any[]): any[] {
  if (!Array.isArray(filters)) {
    return []
  }
  const out: any[] = []
  const walk = (entry: any): void => {
    if (!entry || typeof entry !== 'object') {
      return
    }
    if (entry.type === 'group' && Array.isArray(entry.children)) {
      for (const child of entry.children) {
        walk(child)
      }
      return
    }
    // Backwards-compatible: entries without an explicit `type` (legacy flat
    // form) and entries explicitly tagged `condition` are both treated as
    // condition leaves.
    if (entry.type === undefined || entry.type === 'condition') {
      out.push(entry)
    }
  }
  for (const entry of filters) {
    walk(entry)
  }
  return out
}

// Walks a flat filter list to extract every `urlSearchParams` reference key
// (e.g. `'categoryFilter'`). Used to (a) inject `const router = useRouter()`
// once at the top of the component, (b) wire `router.query.<key>` into the
// `useMemo` dependency array so the client-side fetch reruns whenever the
// buyer navigates to a URL with a different `?key=value`. Returned in the
// order keys first appear so the generated dep array stays stable.
function collectFilterUrlSearchParamKeys(filters: any[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of filters) {
    const dest = f?.destination
    if (!ASTUtils.isUIDLDynamicReference(dest)) {
      continue
    }
    const content = (dest as { content?: { referenceType?: string; id?: string } }).content
    if (!content || content.referenceType !== 'urlSearchParams' || !content.id) {
      continue
    }
    if (seen.has(content.id)) {
      continue
    }
    seen.add(content.id)
    out.push(content.id)
  }
  return out
}

// Returns true when any filter destination is a `urlSearchParams` dynamic
// reference — used by the plugin to know it needs to import `useRouter` and
// emit `const router = useRouter()` at the top of the component. Cheaper to
// test against the precomputed key list once than to walk all filters on
// every check.
function hasUrlSearchParamFilters(usage: DataSourceUsage): boolean {
  return usage.filterUrlSearchParamKeys.length > 0
}

// Appends `router.query.<key>` member expressions to a useMemo deps array so
// every client-side fetch refires when the buyer navigates between URLs
// that differ only by `?key=value`. React's shallow-compare semantics treat
// the member expression as a distinct value per render, so the array stays
// stable across paints with the same query string and changes the moment
// the URL does. Skip the bare-identifier dedupe `filterStateIds` uses —
// member expressions never collide with state identifiers, and the deps
// array allows duplicates without harm.
function pushUrlSearchParamMemoDeps(memoDeps: types.Expression[], usage: DataSourceUsage): void {
  for (const key of usage.filterUrlSearchParamKeys) {
    memoDeps.push(
      types.memberExpression(
        types.memberExpression(types.identifier('router'), types.identifier('query')),
        types.identifier(key)
      )
    )
  }
}

// Builds the AST for `!router.query.<key1> && !router.query.<key2> && ...`,
// used as a runtime guard around `initialData={props.X}` so the server-
// prefetched (unfiltered) data is only handed to `DataProvider` when the
// URL has no active filter. Without this guard, navigating to
// `/products-list?categoryFilter=Rings` (especially via soft Next.js
// transitions where the page component remounts with fresh getStaticProps
// but the buyer's URL filter is still in scope) shows the unfiltered list
// for the first paint AND keeps it on screen because `DataProvider`'s
// `passFetchBecauseWeHaveInitialData` ref skips the very first fetch when
// `initialData !== undefined`. By emitting `undefined` here whenever ANY
// url-search-param filter is set, the DataProvider's mount-time fetch runs
// immediately with the filtered params instead of presenting stale data.
//
// Returns `null` when the usage has no url-search-param filters at all —
// callers fall back to the existing `props.X` expression unchanged so
// non-filtered pages still benefit from the SSR prefetch.
function buildNoUrlFilterGuard(usage: DataSourceUsage): types.Expression | null {
  if (
    usage.filterUrlSearchParamKeys.length === 0 &&
    usage.filterStateIds.length === 0 &&
    usage.filterPropIds.length === 0
  ) {
    return null
  }
  const guards: types.Expression[] = []
  for (const key of usage.filterUrlSearchParamKeys) {
    guards.push(
      types.unaryExpression(
        '!',
        types.memberExpression(
          types.memberExpression(types.identifier('router'), types.identifier('query')),
          types.identifier(key)
        ),
        true
      )
    )
  }
  // State-bound filter destinations (e.g. `selectedCategory`) emit as bare
  // identifiers, so the corresponding guard is `!selectedCategory`. An empty
  // string ('') for the state — which the GUI emits when the user picks the
  // "All Categories" reset option — is falsy and so passes through the guard
  // exactly like a missing URL param: initialData (unfiltered prefetch) wins
  // until the user picks a real value.
  for (const id of usage.filterStateIds) {
    guards.push(types.unaryExpression('!', types.identifier(id), true))
  }
  // Prop-bound filter destinations read `props.<id>` (a constant per page
  // instance), so the guard is `!props.<id>` — mirroring the value expression
  // exactly so the bare-identifier ReferenceError can't reappear here.
  for (const id of usage.filterPropIds) {
    guards.push(
      types.unaryExpression(
        '!',
        types.memberExpression(types.identifier('props'), types.identifier(id)),
        true
      )
    )
  }
  return guards.reduce((acc, next) => types.logicalExpression('&&', acc, next))
}

// Wraps an existing `initialData` condition with the additional "no URL
// filter active" guard so server-prefetched data is only handed to
// DataProvider when both (a) the original guard (page === 1, no search
// query, etc.) AND (b) every relevant `router.query.<key>` is falsy. See
// `buildNoUrlFilterGuard` for the rationale on why bare-identity feature
// detection is safer than the `dynamicSort`-style "always undefined" path.
function wrapInitialDataWithUrlFilterGuard(
  baseCondition: types.Expression,
  usage: DataSourceUsage
): types.Expression {
  const noFilterGuard = buildNoUrlFilterGuard(usage)
  if (!noFilterGuard) {
    return baseCondition
  }
  return types.logicalExpression('&&', baseCondition, noFilterGuard)
}

// Builds the destination AST for a single filter entry. Replaces the bare
// `ASTUtils.convertFilterDestinationToExpression(filter.destination)` call
// at every emit site so `urlSearchParams` references resolve to
// `router?.query?.<key>` instead of falling through to a bare identifier
// (which the existing helper would emit, leaving the client-side fetch
// referencing an undeclared symbol).
//
// State and prop references delegate back to the shared helper so the
// existing inspector behaviour (state-bound filter destinations) keeps
// working unchanged. `router?.query?.<key>` is the same shape the
// `createNextUrlSearchParamsPlugin`-driven `dynamicReferencePrefixMap`
// emits for page-level navlink reads.
function buildFilterDestinationExpression(destination: unknown): types.Expression {
  if (ASTUtils.isUIDLDynamicReference(destination)) {
    const content = (destination as { content?: { referenceType?: string; id?: string } }).content
    if (content?.referenceType === 'urlSearchParams' && content?.id) {
      // router?.query?.<id> — the optional-chain survives the first paint
      // where Next.js's `useRouter()` returns `null` during static export
      // hydration, so the fetch doesn't crash with "Cannot read properties
      // of null" before the router is ready.
      return types.optionalMemberExpression(
        types.optionalMemberExpression(
          types.identifier('router'),
          types.identifier('query'),
          false,
          true
        ),
        types.identifier(content.id),
        false,
        true
      )
    }
  }
  return ASTUtils.convertFilterDestinationToExpression(destination)
}

// Scan UIDL to find all data source usages and build a registry
function buildStateRegistry(uidlNode: any): StateRegistry {
  const usages: DataSourceUsage[] = []
  const byDataSourceId = new Map<string, DataSourceUsage[]>()
  const byArrayMapperRenderProp = new Map<string, DataSourceUsage>()
  let index = 0

  const traverse = (
    node: any,
    parentDataSource?: { identifier: string; resourceDef: any; resourceParams: any }
  ): void => {
    if (!node || typeof node !== 'object') {
      return
    }

    // Found a data-source-list (DataProvider)
    if (node.type === 'data-source-list' && node.content?.renderPropIdentifier) {
      const dsIdentifier = node.content.renderPropIdentifier
      const resourceDef = node.content.resourceDefinition || {}
      const resourceParams = node.content.resource?.params || {}

      // Look for cms-list-repeater inside this data-source-list
      const newParent = {
        identifier: dsIdentifier,
        resourceDef,
        resourceParams,
      }

      // Traverse into success/error/loading nodes
      if (node.content.nodes?.success) {
        traverse(node.content.nodes.success, newParent)
      }
      if (node.content.nodes?.error) {
        traverse(node.content.nodes.error, newParent)
      }
      if (node.content.nodes?.loading) {
        traverse(node.content.nodes.loading, newParent)
      }
      return
    }

    // Found a cms-list-repeater (Repeater with pagination/search config)
    const isCmsListRepeater =
      node.type === 'cms-list-repeater' ||
      (node.type === 'element' && node.content?.elementType === 'cms-list-repeater')

    if (isCmsListRepeater && parentDataSource) {
      const content = node.content || node
      const arrayMapperRenderProp = content.renderPropIdentifier

      if (arrayMapperRenderProp) {
        // Extract query columns from parent's resource params
        let queryColumns: string[] = []
        if (parentDataSource.resourceParams?.queryColumns?.content) {
          queryColumns = parentDataSource.resourceParams.queryColumns.content
        }

        // Extract sorts from parent's resource params (legacy static array form)
        let sorts: any[] = []
        if (parentDataSource.resourceParams?.sorts?.content) {
          sorts = parentDataSource.resourceParams.sorts.content
        }

        // If legacy sorts aren't set, fall back to the new dynamic single-column
        // sort fields on the cms-list-repeater (used by admin-panel listing pages).
        let dynamicSort: DynamicSortAST | undefined
        if ((!sorts || sorts.length === 0) && content.sort) {
          dynamicSort = extractDynamicSort(content.sort, content.sortDirection)
        }

        // Extract filters from parent's resource params. The inspector wraps
        // every condition in a `{ type: 'group' }` envelope (single-group or
        // nested), so flatten to leaf conditions before the downstream emit
        // sites consume `.source` / `.destination` / `.operand` directly —
        // they expect a flat condition array. See `flattenFilterGroups`'s
        // header comment for why AND-flattening is the correct fallback for
        // the API endpoint's flat-condition contract.
        let filters: any[] = []
        if (parentDataSource.resourceParams?.filters?.content) {
          filters = flattenFilterGroups(parentDataSource.resourceParams.filters.content)
        }

        // Split dynamic destination keys by reference type. `state`/`prop`
        // refs resolve to bare identifiers (so they're useMemo deps as-is);
        // `urlSearchParams` refs resolve to `router.query.<key>` and need a
        // `useRouter()` declaration injected separately.
        const filterStateIds: string[] = []
        const filterPropIds: string[] = []
        for (const f of filters) {
          if (!ASTUtils.isUIDLDynamicReference(f.destination)) {
            continue
          }
          const destinationContent = (
            f.destination as { content?: { referenceType?: string; id?: string } }
          ).content
          if (!destinationContent || !destinationContent.id) {
            continue
          }
          if (destinationContent.referenceType === 'urlSearchParams') {
            continue
          }
          // `prop` destinations resolve to `props.<id>` (see
          // buildFilterDestinationExpression / convertFilterDestinationToExpression),
          // so they must NOT be emitted as bare deps. Route them to filterPropIds.
          if (destinationContent.referenceType === 'prop') {
            filterPropIds.push(destinationContent.id)
            continue
          }
          filterStateIds.push(destinationContent.id)
        }
        const filterUrlSearchParamKeys: string[] = collectFilterUrlSearchParamKeys(filters)

        // Extract limit from parent's resource params (for plain array mappers)
        let limit = 0
        if (parentDataSource.resourceParams?.limit?.content) {
          limit = parentDataSource.resourceParams.limit.content
        }

        // For paginated mappers, use perPage from cms-list-repeater
        // For plain mappers, use limit from data-source-list resource params
        const effectivePerPage = content.paginated ? content.perPage : limit || content.perPage

        const searchDefaultValue = parseSearchDefaultValue(content.searchDefaultValue)

        // URL two-way binding key for the search input. Only honoured when it
        // is a non-empty string; blank / non-string values fall back to the
        // plain (non-URL-synced) search behaviour.
        const searchUrlParamKey =
          typeof content.searchUrlParamKey === 'string' &&
          content.searchUrlParamKey.trim().length > 0
            ? content.searchUrlParamKey.trim()
            : undefined

        const usage: DataSourceUsage = {
          index: index++,
          dataSourceIdentifier: parentDataSource.identifier,
          arrayMapperRenderProp,
          resourceDefinition: {
            dataSourceId: parentDataSource.resourceDef.dataSourceId || '',
            tableName: parentDataSource.resourceDef.tableName || '',
            dataSourceType: parentDataSource.resourceDef.dataSourceType || '',
          },
          paginated: !!content.paginated,
          perPage: effectivePerPage,
          searchEnabled: !!content.searchEnabled,
          searchDebounce: content.searchDebounce || 300,
          searchDefaultValue,
          searchUrlParamKey,
          queryColumns,
          sorts,
          dynamicSort,
          filters,
          filterStateIds,
          filterPropIds,
          filterUrlSearchParamKeys,
          cache: resolveCacheFromRepeaterContent(content.cache, parentDataSource.resourceDef),
          category: 'plain',
        }

        // Determine category
        if (usage.paginated && usage.searchEnabled) {
          usage.category = 'paginated+search'
        } else if (usage.paginated) {
          usage.category = 'paginated-only'
        } else if (usage.searchEnabled) {
          usage.category = 'search-only'
        }

        usages.push(usage)

        // Add to maps
        if (!byDataSourceId.has(usage.dataSourceIdentifier)) {
          byDataSourceId.set(usage.dataSourceIdentifier, [])
        }
        byDataSourceId.get(usage.dataSourceIdentifier)!.push(usage)
        byArrayMapperRenderProp.set(arrayMapperRenderProp, usage)
      }

      // Continue traversing inside the repeater
      if (content.nodes?.list) {
        traverse(content.nodes.list, parentDataSource)
      }
      return
    }

    // Recurse into children
    if (node.content?.children && Array.isArray(node.content.children)) {
      for (const child of node.content.children) {
        traverse(child, parentDataSource)
      }
    }
    if (node.content?.node) {
      traverse(node.content.node, parentDataSource)
    }
    if (node.content?.nodes) {
      if (node.content.nodes.success) {
        traverse(node.content.nodes.success, parentDataSource)
      }
      if (node.content.nodes.error) {
        traverse(node.content.nodes.error, parentDataSource)
      }
      if (node.content.nodes.loading) {
        traverse(node.content.nodes.loading, parentDataSource)
      }
      if (node.content.nodes.list) {
        traverse(node.content.nodes.list, parentDataSource)
      }
      if (node.content.nodes.empty) {
        traverse(node.content.nodes.empty, parentDataSource)
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child, parentDataSource)
      }
    }
  }

  traverse(uidlNode)

  return { usages, byDataSourceId, byArrayMapperRenderProp }
}

// Generate state variable names for a usage
function getStateVarsForUsage(usage: DataSourceUsage): {
  pageStateVar: string
  setPageStateVar: string
  maxPagesStateVar: string
  setMaxPagesStateVar: string
  searchQueryVar: string
  setSearchQueryVar: string
  debouncedSearchQueryVar: string
  setDebouncedSearchQueryVar: string
  combinedStateVar: string
  setCombinedStateVar: string
  skipDebounceRefVar: string
  propsPrefix: string
} {
  const idx = usage.index

  return {
    pageStateVar: `ds_${idx}_page`,
    setPageStateVar: `setDs_${idx}_page`,
    maxPagesStateVar: `ds_${idx}_maxPages`,
    setMaxPagesStateVar: `setDs_${idx}_maxPages`,
    searchQueryVar: `ds_${idx}_searchQuery`,
    setSearchQueryVar: `setDs_${idx}_searchQuery`,
    debouncedSearchQueryVar: `ds_${idx}_debouncedQuery`,
    setDebouncedSearchQueryVar: `setDs_${idx}_debouncedQuery`,
    combinedStateVar: `ds_${idx}_state`,
    setCombinedStateVar: `setDs_${idx}_state`,
    skipDebounceRefVar: `ds_${idx}_skipDebounce`,
    propsPrefix: `${usage.dataSourceIdentifier}_ds_${idx}`,
  }
}

// True when a usage actually emits the search ⇄ URL sync effects: it must carry
// a non-empty `searchUrlParamKey` AND own a search query state (only the
// `paginated+search` and `search-only` categories declare `ds_N_searchQuery`).
// Single source of truth for both the effect emission and the `useRouter`
// injection, so a `searchUrlParamKey` mistakenly set on a non-search mapper
// never injects an unused `const router = useRouter()`.
function usageHasSearchUrlSync(usage: DataSourceUsage): boolean {
  return (
    !!usage.searchUrlParamKey &&
    (usage.category === 'paginated+search' || usage.category === 'search-only')
  )
}

// Emits the two URL-sync effects for a search input bound to a URL param
// (`searchUrlParamKey`), reusing the shared `URLSearchParamSync` builders so the
// search input behaves exactly like the `selectedCategory` / `sortBy` dropdowns:
//
//   • read-back  (URL → input): browser back/forward, shallow `router.push`,
//     and deep links flow into the immediate `ds_N_searchQuery` input state;
//     the existing debounce effect then carries the change into the debounced
//     value and the data fetch.
//   • write-back (debounced → URL): the DEBOUNCED query is pushed onto the URL
//     so it survives reloads and is shareable. Keying on the debounced value
//     (not the raw input) means the URL updates only after the user stops
//     typing — never on every keystroke — honouring the "search runs after a
//     debounce" contract and avoiding a flood of `router.replace` history
//     churn.
//
// Loop-free: the write-back skips when the URL already equals the value, and the
// read-back uses functional `setState(prev => prev === next ? prev : next)`, so
// a user edit fires write-back once and the echoed read-back bails without a
// re-render. No-op unless the usage actually has a search query state
// (paginated+search or search-only) AND a non-empty `searchUrlParamKey`.
function pushSearchUrlSyncEffects(
  effectStatements: types.Statement[],
  usage: DataSourceUsage,
  vars: ReturnType<typeof getStateVarsForUsage>
): void {
  if (!usageHasSearchUrlSync(usage)) {
    return
  }

  // The canonical (debounced) query the URL should reflect. For
  // paginated+search it lives on the combined state object as
  // `ds_N_state.debouncedQuery`; for search-only it is the standalone
  // `ds_N_debouncedQuery` state.
  const buildDebouncedValueExpr = (): types.Expression =>
    usage.category === 'paginated+search'
      ? types.memberExpression(
          types.identifier(vars.combinedStateVar),
          types.identifier('debouncedQuery')
        )
      : types.identifier(vars.debouncedSearchQueryVar)

  // write-back: debounced query → `?<searchUrlParamKey>=`
  effectStatements.push(
    URLSearchParamSync.buildUrlWriteBackEffect(
      usage.searchUrlParamKey,
      buildDebouncedValueExpr(),
      buildDebouncedValueExpr()
    )
  )
  // read-back: `?<searchUrlParamKey>=` → input (`setDs_N_searchQuery`). The
  // debounce effect propagates the change into the debounced value + fetch.
  effectStatements.push(
    URLSearchParamSync.buildUrlReadBackEffect(usage.searchUrlParamKey, vars.setSearchQueryVar)
  )
}

// ==================== MAIN PLUGIN ====================

export const createNextArrayMapperPaginationPlugin: ComponentPluginFactory<{}> = () => {
  const paginationPlugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure

    const componentChunk = chunks.find((chunk) => chunk.name === 'jsx-component')
    if (!componentChunk || componentChunk.type !== ChunkType.AST) {
      return structure
    }

    if (!options || !options.dataSources || !options.extractedResources) {
      return structure
    }

    const variableDeclaration = componentChunk.content as types.VariableDeclaration
    if (!variableDeclaration.declarations || variableDeclaration.declarations.length === 0) {
      return structure
    }
    const declarator = variableDeclaration.declarations[0] as types.VariableDeclarator
    if (!declarator.init) {
      return structure
    }
    const arrowFunction = declarator.init as types.ArrowFunctionExpression
    if (!arrowFunction.body) {
      return structure
    }
    const blockStatement = arrowFunction.body as types.BlockStatement

    // STEP 1: Build state registry from UIDL
    const registry = buildStateRegistry(uidl.node)

    if (registry.usages.length === 0) {
      return structure
    }

    // Check if this is a page or component
    // Pages have getStaticProps, components don't
    const getStaticPropsChunk = chunks.find((chunk) => chunk.name === 'getStaticProps')
    const isPage = !!getStaticPropsChunk

    // Add React dependencies
    if (!dependencies.useState) {
      dependencies.useState = {
        type: 'library',
        path: 'react',
        version: '',
        meta: { namedImport: true },
      }
    }
    if (!dependencies.useMemo) {
      dependencies.useMemo = {
        type: 'library',
        path: 'react',
        version: '',
        meta: { namedImport: true },
      }
    }
    if (!dependencies.useCallback) {
      dependencies.useCallback = {
        type: 'library',
        path: 'react',
        version: '',
        meta: { namedImport: true },
      }
    }
    if (!dependencies.useRef) {
      dependencies.useRef = {
        type: 'library',
        path: 'react',
        version: '',
        meta: { namedImport: true },
      }
    }
    if (!dependencies.useEffect) {
      dependencies.useEffect = {
        type: 'library',
        path: 'react',
        version: '',
        meta: { namedImport: true },
      }
    }

    if (!componentChunk.meta) {
      componentChunk.meta = {}
    }
    componentChunk.meta.isClientComponent = true

    // STEP 2: Generate state declarations for all usages
    const stateDeclarations: types.Statement[] = []
    const effectStatements: types.Statement[] = []

    registry.usages.forEach((usage) => {
      if (usage.category === 'plain') {
        return // Plain mappers don't need state
      }

      const vars = getStateVarsForUsage(usage)

      if (usage.category === 'paginated+search') {
        // Combined state object for pagination + search
        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.identifier(vars.skipDebounceRefVar),
              types.callExpression(types.identifier('useRef'), [types.booleanLiteral(true)])
            ),
          ])
        )

        // maxPages state
        const maxPagesInit = isPage
          ? types.logicalExpression(
              '||',
              types.optionalMemberExpression(
                types.identifier('props'),
                types.identifier(`${vars.propsPrefix}_maxPages`),
                false,
                true
              ),
              types.numericLiteral(0)
            )
          : types.numericLiteral(0)

        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.maxPagesStateVar),
                types.identifier(vars.setMaxPagesStateVar),
              ]),
              types.callExpression(types.identifier('useState'), [maxPagesInit])
            ),
          ])
        )

        // Combined state { page, debouncedQuery }
        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.combinedStateVar),
                types.identifier(vars.setCombinedStateVar),
              ]),
              types.callExpression(types.identifier('useState'), [
                types.objectExpression([
                  types.objectProperty(types.identifier('page'), types.numericLiteral(1)),
                  types.objectProperty(
                    types.identifier('debouncedQuery'),
                    buildSearchQueryInitAST(usage)
                  ),
                ]),
              ])
            ),
          ])
        )

        // Immediate search query state — seeded with `searchDefaultValue` (or
        // the `searchUrlParamKey` URL value when bound) so the input is
        // pre-filled on mount. The debounced value above is seeded identically
        // so a deep-linked `?searchKeyword=` fetches filtered results on the
        // first paint: the paginated+search `initialData` is gated on
        // `!ds_N_state.debouncedQuery`, so a non-empty seed forces the
        // DataProvider to fetch instead of reusing the unfiltered SSG prefetch.
        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.searchQueryVar),
                types.identifier(vars.setSearchQueryVar),
              ]),
              types.callExpression(types.identifier('useState'), [buildSearchQueryInitAST(usage)])
            ),
          ])
        )

        // Debounce effect
        effectStatements.push(
          types.expressionStatement(
            types.callExpression(types.identifier('useEffect'), [
              types.arrowFunctionExpression(
                [],
                types.blockStatement([
                  types.ifStatement(
                    types.memberExpression(
                      types.identifier(vars.skipDebounceRefVar),
                      types.identifier('current')
                    ),
                    types.blockStatement([
                      types.expressionStatement(
                        types.assignmentExpression(
                          '=',
                          types.memberExpression(
                            types.identifier(vars.skipDebounceRefVar),
                            types.identifier('current')
                          ),
                          types.booleanLiteral(false)
                        )
                      ),
                      types.returnStatement(),
                    ])
                  ),
                  types.variableDeclaration('const', [
                    types.variableDeclarator(
                      types.identifier('timer'),
                      types.callExpression(types.identifier('setTimeout'), [
                        types.arrowFunctionExpression(
                          [],
                          types.blockStatement([
                            types.expressionStatement(
                              types.callExpression(types.identifier(vars.setCombinedStateVar), [
                                types.objectExpression([
                                  types.objectProperty(
                                    types.identifier('page'),
                                    types.numericLiteral(1)
                                  ),
                                  types.objectProperty(
                                    types.identifier('debouncedQuery'),
                                    types.identifier(vars.searchQueryVar)
                                  ),
                                ]),
                              ])
                            ),
                          ])
                        ),
                        types.numericLiteral(usage.searchDebounce),
                      ])
                    ),
                  ]),
                  types.returnStatement(
                    types.arrowFunctionExpression(
                      [],
                      types.callExpression(types.identifier('clearTimeout'), [
                        types.identifier('timer'),
                      ])
                    )
                  ),
                ])
              ),
              types.arrayExpression([types.identifier(vars.searchQueryVar)]),
            ])
          )
        )

        // Count refetch effect
        const fileName = generateSafeFileName(
          usage.resourceDefinition.dataSourceType,
          usage.resourceDefinition.tableName,
          usage.resourceDefinition.dataSourceId
        )
        const urlParams: types.ObjectProperty[] = [
          types.objectProperty(
            types.identifier('query'),
            types.memberExpression(
              types.identifier(vars.combinedStateVar),
              types.identifier('debouncedQuery')
            )
          ),
        ]
        if (usage.queryColumns.length > 0) {
          urlParams.push(
            types.objectProperty(
              types.identifier('queryColumns'),
              types.callExpression(
                types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
                [types.arrayExpression(usage.queryColumns.map((c) => types.stringLiteral(c)))]
              )
            )
          )
        }
        // Add sorts to count fetch params if present
        if (usage.sorts && usage.sorts.length > 0) {
          urlParams.push(
            types.objectProperty(
              types.identifier('sorts'),
              types.callExpression(
                types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
                [
                  types.arrayExpression(
                    usage.sorts.map((sort: any) =>
                      types.objectExpression([
                        types.objectProperty(
                          types.identifier('field'),
                          types.stringLiteral(sort.field || '')
                        ),
                        types.objectProperty(
                          types.identifier('order'),
                          types.stringLiteral(sort.order || '')
                        ),
                      ])
                    )
                  ),
                ]
              )
            )
          )
        }
        // Add filters to count fetch params if present
        appendFiltersParam(urlParams, usage.filters, buildFilterDestinationExpression)

        // Build the count fetch effect body
        const countFetchEffectBody: types.Statement[] = []

        // Refresh the count on mount (no skip-on-mount guard). Pages seed maxPages
        // from the build-time `getStaticProps` count, but that snapshot goes stale:
        // rows added AFTER the build (e.g. the normalized product_variants table,
        // which is seeded/grows past one page during store generation) are not
        // reflected, so a frozen maxPages of 0/1 leaves "Next" permanently disabled
        // on data-heavy tables. Re-fetching the live count on mount corrects
        // maxPages so pagination tracks the real row count. The effect still runs
        // when the search query or a filter changes (see deps below).

        // Add the fetch call
        countFetchEffectBody.push(
          types.expressionStatement(
            types.callExpression(
              types.memberExpression(
                types.callExpression(
                  types.memberExpression(
                    types.callExpression(types.identifier('fetch'), [
                      types.templateLiteral(
                        [
                          types.templateElement({
                            raw: `/api/${fileName}-count?`,
                            cooked: `/api/${fileName}-count?`,
                          }),
                          types.templateElement({ raw: '', cooked: '' }),
                        ],
                        [
                          types.newExpression(types.identifier('URLSearchParams'), [
                            types.objectExpression(urlParams),
                          ]),
                        ]
                      ),
                    ]),
                    types.identifier('then')
                  ),
                  [
                    types.arrowFunctionExpression(
                      [types.identifier('res')],
                      types.callExpression(
                        types.memberExpression(types.identifier('res'), types.identifier('json')),
                        []
                      )
                    ),
                  ]
                ),
                types.identifier('then')
              ),
              [
                types.arrowFunctionExpression(
                  [types.identifier('data')],
                  types.blockStatement([
                    types.ifStatement(
                      types.logicalExpression(
                        '&&',
                        types.identifier('data'),
                        types.binaryExpression(
                          'in',
                          types.stringLiteral('count'),
                          types.identifier('data')
                        )
                      ),
                      types.blockStatement([
                        types.expressionStatement(
                          types.callExpression(types.identifier(vars.setMaxPagesStateVar), [
                            types.conditionalExpression(
                              types.binaryExpression(
                                '===',
                                types.memberExpression(
                                  types.identifier('data'),
                                  types.identifier('count')
                                ),
                                types.numericLiteral(0)
                              ),
                              types.numericLiteral(0),
                              types.callExpression(
                                types.memberExpression(
                                  types.identifier('Math'),
                                  types.identifier('ceil')
                                ),
                                [
                                  types.binaryExpression(
                                    '/',
                                    types.memberExpression(
                                      types.identifier('data'),
                                      types.identifier('count')
                                    ),
                                    types.numericLiteral(usage.perPage)
                                  ),
                                ]
                              )
                            ),
                          ])
                        ),
                      ])
                    ),
                  ])
                ),
              ]
            )
          )
        )

        const countEffectDeps: types.Expression[] = [
          types.memberExpression(
            types.identifier(vars.combinedStateVar),
            types.identifier('debouncedQuery')
          ),
        ]
        // Refresh the count whenever a state-bound filter destination changes
        // (e.g. user picks a category) so pagination tracks the filtered
        // result-set, not the mount-time unfiltered total. Without these
        // deps, ds_0_maxPages stays at the original count and the "Next"
        // button stays enabled past the actual last page of the filtered
        // results — letting the user click into empty pages.
        const countEffectSeen = new Set<string>()
        pushStateIdsAsDeps(countEffectDeps, countEffectSeen, usage.filterStateIds)
        pushPropIdsAsDeps(countEffectDeps, countEffectSeen, usage.filterPropIds)
        // Same goes for URL-driven filters (already documented above).
        pushUrlSearchParamMemoDeps(countEffectDeps, usage)
        effectStatements.push(
          types.expressionStatement(
            types.callExpression(types.identifier('useEffect'), [
              types.arrowFunctionExpression([], types.blockStatement(countFetchEffectBody)),
              types.arrayExpression(countEffectDeps),
            ])
          )
        )

        // Two-way URL sync for the search input when bound to a URL param.
        pushSearchUrlSyncEffects(effectStatements, usage, vars)
      } else if (usage.category === 'paginated-only') {
        // Simple page state
        const maxPagesInit = isPage
          ? types.logicalExpression(
              '||',
              types.optionalMemberExpression(
                types.identifier('props'),
                types.identifier(`${vars.propsPrefix}_maxPages`),
                false,
                true
              ),
              types.numericLiteral(0)
            )
          : types.numericLiteral(0)

        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.maxPagesStateVar),
                types.identifier(vars.setMaxPagesStateVar),
              ]),
              types.callExpression(types.identifier('useState'), [maxPagesInit])
            ),
          ])
        )

        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.pageStateVar),
                types.identifier(vars.setPageStateVar),
              ]),
              types.callExpression(types.identifier('useState'), [types.numericLiteral(1)])
            ),
          ])
        )

        // For components (not pages), add a useEffect to fetch count on mount
        // Pages get count from getStaticProps, but components need to fetch it client-side
        if (!isPage) {
          const fileName = generateSafeFileName(
            usage.resourceDefinition.dataSourceType,
            usage.resourceDefinition.tableName,
            usage.resourceDefinition.dataSourceId
          )

          effectStatements.push(
            types.expressionStatement(
              types.callExpression(types.identifier('useEffect'), [
                types.arrowFunctionExpression(
                  [],
                  types.blockStatement([
                    types.expressionStatement(
                      types.callExpression(
                        types.memberExpression(
                          types.callExpression(
                            types.memberExpression(
                              types.callExpression(types.identifier('fetch'), [
                                types.stringLiteral(`/api/${fileName}-count`),
                              ]),
                              types.identifier('then')
                            ),
                            [
                              types.arrowFunctionExpression(
                                [types.identifier('res')],
                                types.callExpression(
                                  types.memberExpression(
                                    types.identifier('res'),
                                    types.identifier('json')
                                  ),
                                  []
                                )
                              ),
                            ]
                          ),
                          types.identifier('then')
                        ),
                        [
                          types.arrowFunctionExpression(
                            [types.identifier('data')],
                            types.blockStatement([
                              types.ifStatement(
                                types.logicalExpression(
                                  '&&',
                                  types.identifier('data'),
                                  types.binaryExpression(
                                    'in',
                                    types.stringLiteral('count'),
                                    types.identifier('data')
                                  )
                                ),
                                types.blockStatement([
                                  types.expressionStatement(
                                    types.callExpression(
                                      types.identifier(vars.setMaxPagesStateVar),
                                      [
                                        types.conditionalExpression(
                                          types.binaryExpression(
                                            '===',
                                            types.memberExpression(
                                              types.identifier('data'),
                                              types.identifier('count')
                                            ),
                                            types.numericLiteral(0)
                                          ),
                                          types.numericLiteral(0),
                                          types.callExpression(
                                            types.memberExpression(
                                              types.identifier('Math'),
                                              types.identifier('ceil')
                                            ),
                                            [
                                              types.binaryExpression(
                                                '/',
                                                types.memberExpression(
                                                  types.identifier('data'),
                                                  types.identifier('count')
                                                ),
                                                types.numericLiteral(usage.perPage)
                                              ),
                                            ]
                                          )
                                        ),
                                      ]
                                    )
                                  ),
                                ])
                              ),
                            ])
                          ),
                        ]
                      )
                    ),
                  ])
                ),
                // Default to mount-only; refresh when ANY filter destination
                // changes — state-bound (e.g. `selectedCategory`) and
                // URL-driven — so the pagination control reflects the current
                // filtered count instead of the unfiltered mount-time total.
                types.arrayExpression(
                  ((): types.Expression[] => {
                    const deps: types.Expression[] = []
                    const depsSeen = new Set<string>()
                    pushStateIdsAsDeps(deps, depsSeen, usage.filterStateIds)
                    pushPropIdsAsDeps(deps, depsSeen, usage.filterPropIds)
                    pushUrlSearchParamMemoDeps(deps, usage)
                    return deps
                  })()
                ),
              ])
            )
          )
        }
      } else if (usage.category === 'search-only') {
        // Search-only state
        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.identifier(vars.skipDebounceRefVar),
              types.callExpression(types.identifier('useRef'), [types.booleanLiteral(true)])
            ),
          ])
        )

        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.debouncedSearchQueryVar),
                types.identifier(vars.setDebouncedSearchQueryVar),
              ]),
              types.callExpression(types.identifier('useState'), [buildSearchQueryInitAST(usage)])
            ),
          ])
        )

        stateDeclarations.push(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.arrayPattern([
                types.identifier(vars.searchQueryVar),
                types.identifier(vars.setSearchQueryVar),
              ]),
              types.callExpression(types.identifier('useState'), [buildSearchQueryInitAST(usage)])
            ),
          ])
        )

        // Debounce effect
        effectStatements.push(
          types.expressionStatement(
            types.callExpression(types.identifier('useEffect'), [
              types.arrowFunctionExpression(
                [],
                types.blockStatement([
                  types.ifStatement(
                    types.memberExpression(
                      types.identifier(vars.skipDebounceRefVar),
                      types.identifier('current')
                    ),
                    types.blockStatement([
                      types.expressionStatement(
                        types.assignmentExpression(
                          '=',
                          types.memberExpression(
                            types.identifier(vars.skipDebounceRefVar),
                            types.identifier('current')
                          ),
                          types.booleanLiteral(false)
                        )
                      ),
                      types.returnStatement(),
                    ])
                  ),
                  types.variableDeclaration('const', [
                    types.variableDeclarator(
                      types.identifier('timer'),
                      types.callExpression(types.identifier('setTimeout'), [
                        types.arrowFunctionExpression(
                          [],
                          types.blockStatement([
                            types.expressionStatement(
                              types.callExpression(
                                types.identifier(vars.setDebouncedSearchQueryVar),
                                [types.identifier(vars.searchQueryVar)]
                              )
                            ),
                          ])
                        ),
                        types.numericLiteral(usage.searchDebounce),
                      ])
                    ),
                  ]),
                  types.returnStatement(
                    types.arrowFunctionExpression(
                      [],
                      types.callExpression(types.identifier('clearTimeout'), [
                        types.identifier('timer'),
                      ])
                    )
                  ),
                ])
              ),
              types.arrayExpression([types.identifier(vars.searchQueryVar)]),
            ])
          )
        )

        // Two-way URL sync for the search input when bound to a URL param.
        pushSearchUrlSyncEffects(effectStatements, usage, vars)
      }
    })

    // Insert state declarations at the beginning
    stateDeclarations.reverse().forEach((s) => blockStatement.body.unshift(s))

    // Inject `const router = useRouter()` at the very top of the component
    // body whenever any usage's filters reference URL search params (e.g.
    // a navlink that bakes `?categoryFilter=Rings` into the href). The
    // filter destination expressions emitted earlier reference `router.query`
    // directly, so the symbol must be in scope by the time the component
    // body runs. We add the dependency + declaration here rather than
    // relying on the sibling `createNextUrlSearchParamsPlugin` because
    // (a) that plugin only fires when the UIDL declares `pageOptions.searchParams`,
    // and (b) component-level data fetches can use URL params even when
    // the page itself has no `searchParams` definition (e.g. a navigation
    // component embedded on a page that didn't author the param). The
    // `body.some(isUseRouterDecl)` guard keeps us idempotent with both the
    // search-params plugin and the i18n plugin, both of which may have
    // already unshifted the same declaration.
    // `useRouter` is also required when a search input is two-way bound to a
    // URL param (`searchUrlParamKey`) — its read-back / write-back effects read
    // `router.query` / `router.isReady` and call `router.replace`. Gated on the
    // same predicate as the effects themselves so router is only injected when
    // it is actually used.
    const needsUseRouter = registry.usages.some(
      (u) => hasUrlSearchParamFilters(u) || usageHasSearchUrlSync(u)
    )
    if (needsUseRouter) {
      if (!dependencies.useRouter) {
        // Match the shape the sibling Next.js plugins use (i18n locale mapper,
        // search-params plugin) so the deduped import line is identical and
        // the dependency-resolver merges instead of emitting a second one.
        dependencies.useRouter = {
          type: 'library',
          path: 'next/router',
          version: '^12.1.10',
          meta: { namedImport: true },
        }
      }
      const hasRouterDecl = blockStatement.body.some(
        (statement) =>
          statement.type === 'VariableDeclaration' &&
          statement.declarations.some(
            (decl) =>
              decl.id.type === 'Identifier' &&
              decl.id.name === 'router' &&
              decl.init?.type === 'CallExpression' &&
              decl.init.callee.type === 'Identifier' &&
              decl.init.callee.name === 'useRouter'
          )
      )
      if (!hasRouterDecl) {
        blockStatement.body.unshift(
          types.variableDeclaration('const', [
            types.variableDeclarator(
              types.identifier('router'),
              types.callExpression(types.identifier('useRouter'), [])
            ),
          ])
        )
      }
    }

    // Insert effects before return statement
    const returnIndex = blockStatement.body.findIndex((s: any) => s.type === 'ReturnStatement')
    const insertIndex = returnIndex !== -1 ? returnIndex : blockStatement.body.length
    effectStatements.reverse().forEach((e) => blockStatement.body.splice(insertIndex, 0, e))

    // STEP 3: Find all DataProviders in JSX that have Repeaters and wire them to correct states
    const dataProviders = findAllDataProvidersInJSX(blockStatement)

    // Filter to only DataProviders with Repeaters (array mappers)
    const dataProvidersWithRepeaters = dataProviders.filter((dp) => {
      const hasRepeater = findArrayMapperRenderPropInDataProvider(dp) !== undefined
      return hasRepeater
    })

    // Track which usage index we're on for each dataSourceIdentifier
    // We use pure order-based matching - the order of DataProviders in JSX should match UIDL order
    const usageIndexByDataSourceId = new Map<string, number>()

    // `useRef` / `useState` pairs backing the refetch loading state of every
    // DataProvider that ended up wired below. Collected here because whether a
    // provider can use one depends on its JSX (it needs a `renderLoading` slot),
    // which is only known once the category updaters above have run.
    const loadingStateDeclarations: types.Statement[] = []
    const cacheDeclarations: types.Statement[] = []

    dataProvidersWithRepeaters.forEach((dp) => {
      const nameAttr = dp.openingElement.attributes.find(
        (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'name'
      )
      if (!nameAttr?.value?.expression?.value) {
        return
      }

      const dataSourceIdentifier = nameAttr.value.expression.value

      // Use pure order-based matching within each dataSourceIdentifier
      const usages = registry.byDataSourceId.get(dataSourceIdentifier) || []
      const currentIndex = usageIndexByDataSourceId.get(dataSourceIdentifier) || 0

      if (currentIndex >= usages.length) {
        return
      }

      const usage = usages[currentIndex]
      usageIndexByDataSourceId.set(dataSourceIdentifier, currentIndex + 1)

      const vars = getStateVarsForUsage(usage)
      const fileName = generateSafeFileName(
        usage.resourceDefinition.dataSourceType,
        usage.resourceDefinition.tableName,
        usage.resourceDefinition.dataSourceId
      )

      // Update DataProvider based on category
      if (usage.category === 'paginated+search') {
        updateDataProviderForPaginatedSearch(dp, usage, vars, fileName, cacheDeclarations)
      } else if (usage.category === 'paginated-only') {
        updateDataProviderForPaginationOnly(dp, usage, vars, fileName, cacheDeclarations)
      } else if (usage.category === 'search-only') {
        updateDataProviderForSearchOnly(dp, usage, vars, fileName, cacheDeclarations)
      } else if (usage.category === 'plain') {
        updateDataProviderForPlain(dp, fileName, usage)
      }

      // Show the array mapper's loading state while a category/sort/search
      // change refetches, instead of leaving the previous rows on screen with
      // no feedback. Runs last so it sees the `fetchData` and
      // `persistDataDuringLoading` attributes the updaters above just wrote.
      const loadingVars = getLoadingStateVars(usage.index)
      if (applyLoadingStateToDataProvider(dp, loadingVars)) {
        loadingStateDeclarations.push(...buildLoadingStateDeclarations(loadingVars))
      }

      // Create API route for all categories (including 'plain' for components)
      ensureAPIRouteExists(
        options.extractedResources,
        usage,
        options.dataSources,
        buildProductTransformOptions(options)
      )
    })

    // tslint:disable-next-line:no-any
    const sharedOptions = options as any
    if (!sharedOptions.serverCacheByFile) {
      sharedOptions.serverCacheByFile = new Map()
    }
    applyServerCacheToDataSourceModules(
      options.extractedResources,
      registry,
      options.dataSources,
      buildProductTransformOptions(options),
      sharedOptions.serverCacheByFile
    )

    // Declare the loading-state hooks alongside the other data-source state, at
    // the top of the component body. Unconditional and in a fixed order, so the
    // hook order stays stable across renders.
    loadingStateDeclarations.reverse().forEach((s) => blockStatement.body.unshift(s))

    const cachedScopes = Array.from(
      new Set(
        registry.usages
          .filter((usage) => usage.cache?.client)
          .map((usage) => (usage.cache as ResolvedDataSourceCache).scope)
      )
    )

    if (cacheDeclarations.length || cachedScopes.length) {
      // One effect per page covering every scope on it: flips the hydration
      // latch, then asks once whether any of this page's tables changed while
      // the visitor was away. Without it a browser serving everything from its
      // own cache would never learn about a write at all. It has to land
      // BEFORE the component's `return` — a plain `push` at this point in the
      // pipeline appends after it, where React never registers the hook.
      ASTStatementOrder.insertStatementsBeforeReturn(blockStatement, [
        buildCacheHydrationEffect(cachedScopes),
      ])
      // `ds_N_params` / `ds_N_cached` read the `ds_N_state` hooks declared
      // above, so they are placed at the earliest point where everything they
      // reference is already in scope — never blindly at the top, which is
      // exactly the `Cannot access 'ds_0_state' before initialization` crash.
      ASTStatementOrder.insertStatementsAfterDependencies(blockStatement, cacheDeclarations)
      registerCacheClientImports(dependencies, uidl.outputOptions?.folderPath)
    }

    // STEP 3.5: Handle DataProviders WITHOUT repeaters (data-source-item type)
    // These access single items like data[0].name and should not re-render on state changes
    // We wrap their params in useMemo to prevent reference changes from triggering re-renders
    const dataProvidersWithoutRepeaters = dataProviders.filter((dp) => {
      const hasRepeater = findArrayMapperRenderPropInDataProvider(dp) !== undefined
      return !hasRepeater
    })

    dataProvidersWithoutRepeaters.forEach((dp) => {
      stabilizeDataProviderWithoutRepeater(dp)
    })

    // STEP 4: Wire search inputs
    // Match search inputs to usages by order (within each dataSourceIdentifier that has search enabled)
    const searchInputs = findAllSearchInputsInJSX(blockStatement)

    // Get all search-enabled usages in order
    const searchEnabledUsages = registry.usages.filter((u) => u.searchEnabled)

    // Match by order - search input 0 -> searchEnabledUsages[0], etc.
    searchInputs.forEach((input, idx) => {
      if (idx >= searchEnabledUsages.length) {
        return
      }

      const usage = searchEnabledUsages[idx]
      const vars = getStateVarsForUsage(usage)
      wireSearchInput(input.node, vars)
    })

    // STEP 5: Wire pagination buttons
    // Match pagination nodes to usages by order (within paginated usages)
    const paginationNodes = findAllPaginationNodesInJSX(blockStatement)

    // Get all paginated usages in order
    const paginatedUsages = registry.usages.filter((u) => u.paginated)

    // Match by order - pagination node 0 -> paginatedUsages[0], etc.
    paginationNodes.forEach((paginationNode, idx) => {
      if (idx >= paginatedUsages.length) {
        return
      }

      const usage = paginatedUsages[idx]
      const vars = getStateVarsForUsage(usage)
      wirePaginationButtons(paginationNode.node, usage, vars)
    })

    // STEP 6: Update getStaticProps if this is a page
    if (isPage) {
      updateGetStaticProps(chunks, registry, dependencies, uidl.outputOptions?.folderPath)
    }

    return structure
  }

  return paginationPlugin
}

// ==================== HELPER FUNCTIONS ====================

function findAllDataProvidersInJSX(blockStatement: types.BlockStatement): any[] {
  const results: any[] = []

  const traverse = (node: any): void => {
    if (!node) {
      return
    }

    if (node.type === 'JSXElement' && node.openingElement?.name?.name === 'DataProvider') {
      results.push(node)
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach((c: any) => traverse(c))
    }

    if (node.body) {
      if (Array.isArray(node.body)) {
        node.body.forEach((s: any) => traverse(s))
      } else {
        traverse(node.body)
      }
    }

    if (node.consequent) {
      traverse(node.consequent)
    }

    if (node.alternate) {
      traverse(node.alternate)
    }

    if (node.expression) {
      traverse(node.expression)
    }

    if (node.argument) {
      traverse(node.argument)
    }

    if (node.arguments) {
      node.arguments.forEach((a: any) => traverse(a))
    }
  }

  traverse(blockStatement)
  return results
}

function findArrayMapperRenderPropInDataProvider(dataProvider: any): string | undefined {
  const renderSuccessAttr = dataProvider.openingElement.attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'renderSuccess'
  )

  if (!renderSuccessAttr?.value?.expression) {
    return undefined
  }

  const findRepeater = (node: any): any => {
    if (!node) {
      return null
    }

    if (node.type === 'JSXElement' && node.openingElement?.name?.name === 'Repeater') {
      return node
    }

    if (node.body) {
      return findRepeater(node.body)
    }

    if (node.children && Array.isArray(node.children)) {
      for (const c of node.children) {
        const r = findRepeater(c)
        if (r) {
          return r
        }
      }
    }
    return null
  }

  const repeater = findRepeater(renderSuccessAttr.value.expression)
  if (!repeater) {
    return undefined
  }

  const renderItemAttr = repeater.openingElement.attributes.find(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'renderItem'
  )

  if (!renderItemAttr?.value?.expression?.params?.[0]?.name) {
    return undefined
  }

  return renderItemAttr.value.expression.params[0].name
}

function findAllSearchInputsInJSX(
  blockStatement: types.BlockStatement
): Array<{ node: any; className: string }> {
  const results: Array<{ node: any; className: string }> = []

  const traverse = (node: any): void => {
    if (!node) {
      return
    }

    if (node.type === 'JSXElement' && node.openingElement?.name?.name === 'input') {
      const classAttr = node.openingElement.attributes?.find(
        (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'className'
      )
      const className = classAttr?.value?.value || classAttr?.value?.expression?.value || ''
      if (className.includes('search-input')) {
        results.push({ node, className })
      }
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach((c: any) => traverse(c))
    }
    if (node.body) {
      if (Array.isArray(node.body)) {
        node.body.forEach((s: any) => traverse(s))
      } else {
        traverse(node.body)
      }
    }
    if (node.consequent) {
      traverse(node.consequent)
    }
    if (node.alternate) {
      traverse(node.alternate)
    }
    if (node.expression) {
      traverse(node.expression)
    }
    if (node.argument) {
      traverse(node.argument)
    }
  }

  traverse(blockStatement)
  return results
}

function findAllPaginationNodesInJSX(
  blockStatement: types.BlockStatement
): Array<{ node: any; className: string }> {
  const results: Array<{ node: any; className: string }> = []

  const traverse = (node: any): void => {
    if (!node) {
      return
    }

    if (node.type === 'JSXElement') {
      const classAttr = node.openingElement?.attributes?.find(
        (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'className'
      )
      const className = classAttr?.value?.value || classAttr?.value?.expression?.value || ''
      if (className.includes('cms-pagination-node')) {
        results.push({ node, className })
      }
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach((c: any) => traverse(c))
    }
    if (node.body) {
      if (Array.isArray(node.body)) {
        node.body.forEach((s: any) => traverse(s))
      } else {
        traverse(node.body)
      }
    }
    if (node.consequent) {
      traverse(node.consequent)
    }
    if (node.alternate) {
      traverse(node.alternate)
    }
    if (node.expression) {
      traverse(node.expression)
    }
    if (node.argument) {
      traverse(node.argument)
    }
  }

  traverse(blockStatement)
  return results
}

/**
 * Emits the provider's `params` and, for a cached mapper, the peek beside it.
 *
 * An uncached mapper keeps the inline `params={useMemo(...)}` it has always had,
 * byte for byte. A cached one hoists that memo into a component const so the
 * peek can depend on the same object identity instead of rebuilding it.
 *
 * Returns the identifier holding the peeked rows, or `undefined` when this
 * mapper does not cache.
 */
function pushParamsAttribute(
  // tslint:disable-next-line:no-any
  dp: any,
  usage: DataSourceUsage,
  paramsProps: types.ObjectProperty[],
  memoDeps: types.Expression[],
  cacheDeclarations: types.Statement[]
): string | undefined {
  const paramsMemo = types.callExpression(types.identifier('useMemo'), [
    types.arrowFunctionExpression([], types.objectExpression(paramsProps)),
    types.arrayExpression(memoDeps),
  ])

  // A state-bound sort deliberately suppresses `initialData` (see the comment at
  // the call site): the prefetch ran without sort params, so reusing anything on
  // mount would mask the current sort. The cache peek is `initialData` by
  // another name, so it has to be suppressed for exactly the same reason.
  const cache = usage.cache?.client && !usage.dynamicSort ? usage.cache : undefined

  if (!cache) {
    dp.openingElement.attributes.push(
      types.jsxAttribute(types.jsxIdentifier('params'), types.jsxExpressionContainer(paramsMemo))
    )
    return undefined
  }

  const hoisted = buildCachedParamsDeclarations({ index: usage.index, paramsMemo, cache })
  cacheDeclarations.push(...hoisted.declarations)

  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('params'),
      types.jsxExpressionContainer(types.identifier(hoisted.paramsIdentifier))
    )
  )

  return hoisted.cachedIdentifier
}

function updateDataProviderForPaginatedSearch(
  dp: any,
  usage: DataSourceUsage,
  vars: ReturnType<typeof getStateVarsForUsage>,
  fileName: string,
  cacheDeclarations: types.Statement[]
): void {
  const attrs = dp.openingElement.attributes

  // Remove existing params, key, initialData, fetchData, persistDataDuringLoading
  dp.openingElement.attributes = attrs.filter(
    (attr: any) =>
      !['params', 'key', 'initialData', 'fetchData', 'persistDataDuringLoading'].includes(
        attr.name?.name
      )
  )

  // Add params with useMemo
  const paramsProps: types.ObjectProperty[] = [
    types.objectProperty(
      types.identifier('page'),
      types.memberExpression(types.identifier(vars.combinedStateVar), types.identifier('page'))
    ),
    types.objectProperty(types.identifier('perPage'), types.numericLiteral(usage.perPage)),
    types.objectProperty(
      types.identifier('query'),
      types.memberExpression(
        types.identifier(vars.combinedStateVar),
        types.identifier('debouncedQuery')
      )
    ),
  ]
  if (usage.queryColumns.length > 0) {
    paramsProps.push(
      types.objectProperty(
        types.identifier('queryColumns'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [types.arrayExpression(usage.queryColumns.map((c) => types.stringLiteral(c)))]
        )
      )
    )
  }

  // Add sorts if present (legacy static array wins; otherwise dynamic state-bound sort)
  appendSortsParam(paramsProps, usage.sorts, usage.dynamicSort)

  // Add filters if present
  appendFiltersParam(paramsProps, usage.filters, buildFilterDestinationExpression)

  // Build useMemo dependencies including filter state IDs and dynamic sort state IDs
  const memoDeps: types.Expression[] = [types.identifier(vars.combinedStateVar)]
  const seenDeps = new Set<string>([vars.combinedStateVar])
  pushStateIdsAsDeps(memoDeps, seenDeps, usage.filterStateIds)
  pushPropIdsAsDeps(memoDeps, seenDeps, usage.filterPropIds)
  if (usage.dynamicSort) {
    pushStateIdsAsDeps(memoDeps, seenDeps, usage.dynamicSort.depStateIds)
  }
  pushUrlSearchParamMemoDeps(memoDeps, usage)

  const cachedInitialData = pushParamsAttribute(dp, usage, paramsProps, memoDeps, cacheDeclarations)

  // Add initialData. Skip the server-prefetched data entirely when a dynamic
  // state-bound sort is active — the prefetch ran without sort parameters, so
  // reusing it would mask the current sort state AND cause DataProvider to skip
  // the first client fetch (its internal guard only skips when initialData is
  // defined on mount). Without that skip, toggling sort correctly triggers a
  // refetch via the useMemo params dependency chain.
  if (!usage.dynamicSort) {
    const initialDataCondition = wrapInitialDataWithUrlFilterGuard(
      types.logicalExpression(
        '&&',
        types.binaryExpression(
          '===',
          types.memberExpression(types.identifier(vars.combinedStateVar), types.identifier('page')),
          types.numericLiteral(1)
        ),
        types.unaryExpression(
          '!',
          types.memberExpression(
            types.identifier(vars.combinedStateVar),
            types.identifier('debouncedQuery')
          ),
          true
        )
      ),
      usage
    )
    dp.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('initialData'),
        types.jsxExpressionContainer(
          types.conditionalExpression(
            initialDataCondition,
            types.optionalMemberExpression(
              types.identifier('props'),
              types.identifier(vars.propsPrefix),
              false,
              true
            ),
            cachedInitialData ? types.identifier(cachedInitialData) : types.identifier('undefined')
          )
        )
      )
    )
  }

  // Add key. Sort is intentionally NOT part of the key — a key change would
  // remount the DataProvider, and a fresh mount re-arms the internal
  // "skip-first-fetch-when-we-have-initialData" guard, which would prevent the
  // new sort params from reaching the fetcher. Leaving sort out of the key
  // lets the useMemo params identity change alone drive refetch.
  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('key'),
      types.jsxExpressionContainer(
        types.templateLiteral(
          [
            types.templateElement({
              raw: `${usage.dataSourceIdentifier}-`,
              cooked: `${usage.dataSourceIdentifier}-`,
            }),
            types.templateElement({ raw: '-', cooked: '-' }),
            types.templateElement({ raw: '', cooked: '' }),
          ],
          [
            types.memberExpression(
              types.identifier(vars.combinedStateVar),
              types.identifier('page')
            ),
            types.memberExpression(
              types.identifier(vars.combinedStateVar),
              types.identifier('debouncedQuery')
            ),
          ]
        )
      )
    )
  )

  // Add fetchData
  dp.openingElement.attributes.push(
    createFetchDataAttribute(fileName, usage.cache?.client ? usage.cache : undefined)
  )

  // Add persistDataDuringLoading
  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('persistDataDuringLoading'),
      types.jsxExpressionContainer(types.booleanLiteral(true))
    )
  )
}

function updateDataProviderForPaginationOnly(
  dp: any,
  usage: DataSourceUsage,
  vars: ReturnType<typeof getStateVarsForUsage>,
  fileName: string,
  cacheDeclarations: types.Statement[]
): void {
  const attrs = dp.openingElement.attributes

  dp.openingElement.attributes = attrs.filter(
    (attr: any) =>
      !['params', 'key', 'initialData', 'fetchData', 'persistDataDuringLoading'].includes(
        attr.name?.name
      )
  )

  // Build params properties
  const paramsProps: types.ObjectProperty[] = [
    types.objectProperty(types.identifier('page'), types.identifier(vars.pageStateVar)),
    types.objectProperty(types.identifier('perPage'), types.numericLiteral(usage.perPage)),
  ]

  // Add sorts if present (legacy static array wins; otherwise dynamic state-bound sort)
  appendSortsParam(paramsProps, usage.sorts, usage.dynamicSort)

  // Add filters if present
  appendFiltersParam(paramsProps, usage.filters, buildFilterDestinationExpression)

  // Build useMemo dependencies including filter state IDs and dynamic sort state IDs
  const memoDeps: types.Expression[] = [types.identifier(vars.pageStateVar)]
  const seenDeps = new Set<string>([vars.pageStateVar])
  pushStateIdsAsDeps(memoDeps, seenDeps, usage.filterStateIds)
  pushPropIdsAsDeps(memoDeps, seenDeps, usage.filterPropIds)
  if (usage.dynamicSort) {
    pushStateIdsAsDeps(memoDeps, seenDeps, usage.dynamicSort.depStateIds)
  }
  pushUrlSearchParamMemoDeps(memoDeps, usage)

  // Add params
  const cachedInitialData = pushParamsAttribute(dp, usage, paramsProps, memoDeps, cacheDeclarations)

  // Add initialData. See paginated+search updater for why we skip prefetch
  // reuse when a dynamic state-bound sort is active.
  if (!usage.dynamicSort) {
    dp.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('initialData'),
        types.jsxExpressionContainer(
          types.conditionalExpression(
            wrapInitialDataWithUrlFilterGuard(
              types.binaryExpression(
                '===',
                types.identifier(vars.pageStateVar),
                types.numericLiteral(1)
              ),
              usage
            ),
            types.optionalMemberExpression(
              types.identifier('props'),
              types.identifier(vars.propsPrefix),
              false,
              true
            ),
            cachedInitialData ? types.identifier(cachedInitialData) : types.identifier('undefined')
          )
        )
      )
    )
  }

  // Add key — sort is intentionally NOT included; see paginated+search updater.
  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('key'),
      types.jsxExpressionContainer(
        types.templateLiteral(
          [
            types.templateElement({
              raw: `${usage.dataSourceIdentifier}-page-`,
              cooked: `${usage.dataSourceIdentifier}-page-`,
            }),
            types.templateElement({ raw: '', cooked: '' }),
          ],
          [types.identifier(vars.pageStateVar)]
        )
      )
    )
  )

  // Add fetchData
  dp.openingElement.attributes.push(
    createFetchDataAttribute(fileName, usage.cache?.client ? usage.cache : undefined)
  )

  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('persistDataDuringLoading'),
      types.jsxExpressionContainer(types.booleanLiteral(true))
    )
  )
}

function updateDataProviderForSearchOnly(
  dp: any,
  usage: DataSourceUsage,
  vars: ReturnType<typeof getStateVarsForUsage>,
  fileName: string,
  cacheDeclarations: types.Statement[]
): void {
  const attrs = dp.openingElement.attributes

  dp.openingElement.attributes = attrs.filter(
    (attr: any) =>
      !['params', 'key', 'initialData', 'fetchData', 'persistDataDuringLoading'].includes(
        attr.name?.name
      )
  )

  // Add params
  const paramsProps: types.ObjectProperty[] = [
    types.objectProperty(types.identifier('query'), types.identifier(vars.debouncedSearchQueryVar)),
  ]
  if (usage.queryColumns.length > 0) {
    paramsProps.push(
      types.objectProperty(
        types.identifier('queryColumns'),
        types.callExpression(
          types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
          [types.arrayExpression(usage.queryColumns.map((c) => types.stringLiteral(c)))]
        )
      )
    )
  }

  // Add sorts if present (legacy static array wins; otherwise dynamic state-bound sort)
  appendSortsParam(paramsProps, usage.sorts, usage.dynamicSort)

  // Add filters if present
  appendFiltersParam(paramsProps, usage.filters, buildFilterDestinationExpression)

  // Build useMemo dependencies including filter state IDs and dynamic sort state IDs
  const memoDeps: types.Expression[] = [types.identifier(vars.debouncedSearchQueryVar)]
  const seenDeps = new Set<string>([vars.debouncedSearchQueryVar])
  pushStateIdsAsDeps(memoDeps, seenDeps, usage.filterStateIds)
  pushPropIdsAsDeps(memoDeps, seenDeps, usage.filterPropIds)
  if (usage.dynamicSort) {
    pushStateIdsAsDeps(memoDeps, seenDeps, usage.dynamicSort.depStateIds)
  }
  pushUrlSearchParamMemoDeps(memoDeps, usage)

  const cachedInitialData = pushParamsAttribute(dp, usage, paramsProps, memoDeps, cacheDeclarations)

  // Add initialData. See paginated+search updater for why we skip prefetch
  // reuse when a dynamic state-bound sort is active.
  if (!usage.dynamicSort) {
    dp.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('initialData'),
        types.jsxExpressionContainer(
          types.conditionalExpression(
            wrapInitialDataWithUrlFilterGuard(
              types.unaryExpression('!', types.identifier(vars.debouncedSearchQueryVar), true),
              usage
            ),
            types.optionalMemberExpression(
              types.identifier('props'),
              types.identifier(vars.propsPrefix),
              false,
              true
            ),
            cachedInitialData ? types.identifier(cachedInitialData) : types.identifier('undefined')
          )
        )
      )
    )
  }

  // Add key — sort is intentionally NOT included; see paginated+search updater.
  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('key'),
      types.jsxExpressionContainer(
        types.templateLiteral(
          [
            types.templateElement({ raw: 'search-', cooked: 'search-' }),
            types.templateElement({ raw: '', cooked: '' }),
          ],
          [types.identifier(vars.debouncedSearchQueryVar)]
        )
      )
    )
  )

  // Add fetchData
  dp.openingElement.attributes.push(
    createFetchDataAttribute(fileName, usage.cache?.client ? usage.cache : undefined)
  )

  dp.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('persistDataDuringLoading'),
      types.jsxExpressionContainer(types.booleanLiteral(true))
    )
  )
}

function updateDataProviderForPlain(dp: any, fileName: string, usage: DataSourceUsage): void {
  const attrs = dp.openingElement.attributes

  const clientCache = usage.cache?.client ? usage.cache : undefined

  // Check if fetchData already exists
  const hasFetchData = attrs.some(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name?.name === 'fetchData'
  )

  if (clientCache) {
    // A plain provider may already carry the UNMEMOIZED fetcher `utils.ts`
    // emits. Caching has to replace it rather than skip: the memoized form is
    // what both the cache peek and the in-flight tracking are attached to.
    dp.openingElement.attributes = attrs.filter(
      (attr: any) => !(attr.type === 'JSXAttribute' && attr.name?.name === 'fetchData')
    )
    dp.openingElement.attributes.push(createFetchDataAttribute(fileName, clientCache))
  } else if (!hasFetchData) {
    attrs.push(createFetchDataAttribute(fileName))
  }

  // Check if persistDataDuringLoading already exists
  const hasPersistData = attrs.some(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name?.name === 'persistDataDuringLoading'
  )

  // If no persistDataDuringLoading, add it
  if (!hasPersistData) {
    attrs.push(
      types.jsxAttribute(
        types.jsxIdentifier('persistDataDuringLoading'),
        types.jsxExpressionContainer(types.booleanLiteral(true))
      )
    )
  }

  // Find the params attribute
  const paramsAttrIndex = attrs.findIndex(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'params'
  )

  if (paramsAttrIndex === -1) {
    return
  }

  const paramsAttr = attrs[paramsAttrIndex] as types.JSXAttribute

  // Check if params is already wrapped in useMemo
  if (
    paramsAttr.value?.type === 'JSXExpressionContainer' &&
    paramsAttr.value.expression.type === 'CallExpression' &&
    (paramsAttr.value.expression.callee as types.Identifier)?.name === 'useMemo'
  ) {
    return
  }

  // Get the current params value expression
  let paramsExpression: types.Expression | null = null

  if (paramsAttr.value?.type === 'JSXExpressionContainer') {
    paramsExpression = paramsAttr.value.expression as types.Expression
  }

  if (!paramsExpression) {
    return
  }

  // Build useMemo dependencies including filter state IDs
  const memoDeps: types.Expression[] = []
  const memoSeen = new Set<string>()
  pushStateIdsAsDeps(memoDeps, memoSeen, usage.filterStateIds)
  pushPropIdsAsDeps(memoDeps, memoSeen, usage.filterPropIds)
  pushUrlSearchParamMemoDeps(memoDeps, usage)

  // Wrap params in useMemo with filter state dependencies
  const memoizedParams = types.callExpression(types.identifier('useMemo'), [
    types.arrowFunctionExpression([], paramsExpression),
    types.arrayExpression(memoDeps),
  ])

  // Replace the params attribute
  attrs[paramsAttrIndex] = types.jsxAttribute(
    types.jsxIdentifier('params'),
    types.jsxExpressionContainer(memoizedParams)
  )
}

function stabilizeDataProviderWithoutRepeater(dp: any): void {
  const attrs = dp.openingElement.attributes

  // Find the params attribute
  const paramsAttrIndex = attrs.findIndex(
    (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'params'
  )

  if (paramsAttrIndex === -1) {
    return
  }

  const paramsAttr = attrs[paramsAttrIndex] as types.JSXAttribute

  // Check if params is already wrapped in useMemo
  if (
    paramsAttr.value?.type === 'JSXExpressionContainer' &&
    paramsAttr.value.expression.type === 'CallExpression' &&
    (paramsAttr.value.expression.callee as types.Identifier)?.name === 'useMemo'
  ) {
    return
  }

  // Get the current params value expression
  let paramsExpression: types.Expression | null = null

  if (paramsAttr.value?.type === 'JSXExpressionContainer') {
    paramsExpression = paramsAttr.value.expression as types.Expression
  }

  if (!paramsExpression) {
    return
  }

  // Wrap params in useMemo with empty dependencies array
  // This ensures the object reference stays stable across re-renders
  const memoizedParams = types.callExpression(types.identifier('useMemo'), [
    types.arrowFunctionExpression([], paramsExpression),
    types.arrayExpression([]),
  ])

  // Replace the params attribute
  attrs[paramsAttrIndex] = types.jsxAttribute(
    types.jsxIdentifier('params'),
    types.jsxExpressionContainer(memoizedParams)
  )
}

function createFetchDataAttribute(
  fileName: string,
  cache?: ResolvedDataSourceCache
): types.JSXAttribute {
  const fetchCall = types.callExpression(types.identifier('fetch'), [
    types.templateLiteral(
      [
        types.templateElement({
          raw: `/api/${fileName}?`,
          cooked: `/api/${fileName}?`,
        }),
        types.templateElement({ raw: '', cooked: '' }),
      ],
      [types.newExpression(types.identifier('URLSearchParams'), [types.identifier('params')])]
    ),
    types.objectExpression([
      types.objectProperty(
        types.identifier('headers'),
        types.objectExpression([
          types.objectProperty(
            types.stringLiteral('Content-Type'),
            types.stringLiteral('application/json')
          ),
        ])
      ),
    ]),
  ])

  const parsedJson = types.callExpression(
    types.memberExpression(fetchCall, types.identifier('then')),
    [
      types.arrowFunctionExpression(
        [types.identifier('res')],
        types.callExpression(
          types.memberExpression(types.identifier('res'), types.identifier('json')),
          []
        )
      ),
    ]
  )

  // The uncached tail is left exactly as it has always been emitted, so a
  // project that does not cache produces byte-identical output.
  const uncachedTail = types.arrowFunctionExpression(
    [types.identifier('response')],
    types.optionalMemberExpression(
      types.identifier('response'),
      types.identifier('data'),
      false,
      true
    )
  )

  const networkChain = types.callExpression(
    types.memberExpression(parsedJson, types.identifier('then')),
    [cache ? buildCacheStoreThen(cache) : uncachedTail]
  )

  const arrow = cache
    ? types.arrowFunctionExpression(
        [types.identifier('params')],
        buildCachedFetchBody(networkChain, cache)
      )
    : types.arrowFunctionExpression([types.identifier('params')], networkChain)

  return types.jsxAttribute(
    types.jsxIdentifier('fetchData'),
    types.jsxExpressionContainer(
      types.callExpression(types.identifier('useCallback'), [arrow, types.arrayExpression([])])
    )
  )
}

function wireSearchInput(inputNode: any, vars: ReturnType<typeof getStateVarsForUsage>): void {
  // Remove existing onChange and value
  inputNode.openingElement.attributes = inputNode.openingElement.attributes.filter(
    (attr: any) => !['onChange', 'value'].includes(attr.name?.name)
  )

  // Add onChange
  inputNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('onChange'),
      types.jsxExpressionContainer(
        types.arrowFunctionExpression(
          [types.identifier('e')],
          types.callExpression(types.identifier(vars.setSearchQueryVar), [
            types.memberExpression(
              types.memberExpression(types.identifier('e'), types.identifier('target')),
              types.identifier('value')
            ),
          ])
        )
      )
    )
  )

  // Add value
  inputNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('value'),
      types.jsxExpressionContainer(types.identifier(vars.searchQueryVar))
    )
  )
}

function wirePaginationButtons(
  paginationNode: any,
  usage: DataSourceUsage,
  vars: ReturnType<typeof getStateVarsForUsage>
): void {
  // Find prev and next buttons
  const findButton = (node: any, direction: 'previous' | 'next'): any => {
    if (!node) {
      return null
    }

    if (node.type === 'JSXElement') {
      const classAttr = node.openingElement?.attributes?.find(
        (attr: any) => attr.type === 'JSXAttribute' && attr.name.name === 'className'
      )
      const className = classAttr?.value?.value || classAttr?.value?.expression?.value || ''
      if (className.includes(direction)) {
        return node
      }
    }

    if (node.children && Array.isArray(node.children)) {
      for (const c of node.children) {
        const found = findButton(c, direction)
        if (found) {
          return found
        }
      }
    }
    return null
  }

  const prevButton = findButton(paginationNode, 'previous')
  const nextButton = findButton(paginationNode, 'next')

  const isCombinedState = usage.category === 'paginated+search'

  if (prevButton) {
    // Change to button element
    prevButton.openingElement.name.name = 'button'
    if (prevButton.closingElement) {
      prevButton.closingElement.name.name = 'button'
    }

    // Add type="button"
    const hasType = prevButton.openingElement.attributes.some((a: any) => a.name?.name === 'type')
    if (!hasType) {
      prevButton.openingElement.attributes.push(
        types.jsxAttribute(types.jsxIdentifier('type'), types.stringLiteral('button'))
      )
    }

    // Add onClick
    prevButton.openingElement.attributes = prevButton.openingElement.attributes.filter(
      (a: any) => a.name?.name !== 'onClick'
    )

    if (isCombinedState) {
      prevButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('onClick'),
          types.jsxExpressionContainer(
            types.arrowFunctionExpression(
              [],
              types.callExpression(types.identifier(vars.setCombinedStateVar), [
                types.arrowFunctionExpression(
                  [types.identifier('state')],
                  types.objectExpression([
                    types.spreadElement(types.identifier('state')),
                    types.objectProperty(
                      types.identifier('page'),
                      types.callExpression(
                        types.memberExpression(types.identifier('Math'), types.identifier('max')),
                        [
                          types.numericLiteral(1),
                          types.binaryExpression(
                            '-',
                            types.memberExpression(
                              types.identifier('state'),
                              types.identifier('page')
                            ),
                            types.numericLiteral(1)
                          ),
                        ]
                      )
                    ),
                  ])
                ),
              ])
            )
          )
        )
      )

      // Add disabled
      prevButton.openingElement.attributes = prevButton.openingElement.attributes.filter(
        (a: any) => a.name?.name !== 'disabled'
      )
      prevButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('disabled'),
          types.jsxExpressionContainer(
            types.binaryExpression(
              '<=',
              types.memberExpression(
                types.identifier(vars.combinedStateVar),
                types.identifier('page')
              ),
              types.numericLiteral(1)
            )
          )
        )
      )
    } else {
      prevButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('onClick'),
          types.jsxExpressionContainer(
            types.arrowFunctionExpression(
              [],
              types.callExpression(types.identifier(vars.setPageStateVar), [
                types.arrowFunctionExpression(
                  [types.identifier('page')],
                  types.callExpression(
                    types.memberExpression(types.identifier('Math'), types.identifier('max')),
                    [
                      types.numericLiteral(1),
                      types.binaryExpression(
                        '-',
                        types.identifier('page'),
                        types.numericLiteral(1)
                      ),
                    ]
                  )
                ),
              ])
            )
          )
        )
      )

      prevButton.openingElement.attributes = prevButton.openingElement.attributes.filter(
        (a: any) => a.name?.name !== 'disabled'
      )
      prevButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('disabled'),
          types.jsxExpressionContainer(
            types.binaryExpression(
              '<=',
              types.identifier(vars.pageStateVar),
              types.numericLiteral(1)
            )
          )
        )
      )
    }
  }

  if (nextButton) {
    nextButton.openingElement.name.name = 'button'
    if (nextButton.closingElement) {
      nextButton.closingElement.name.name = 'button'
    }

    const hasType = nextButton.openingElement.attributes.some((a: any) => a.name?.name === 'type')
    if (!hasType) {
      nextButton.openingElement.attributes.push(
        types.jsxAttribute(types.jsxIdentifier('type'), types.stringLiteral('button'))
      )
    }

    nextButton.openingElement.attributes = nextButton.openingElement.attributes.filter(
      (a: any) => a.name?.name !== 'onClick'
    )

    if (isCombinedState) {
      nextButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('onClick'),
          types.jsxExpressionContainer(
            types.arrowFunctionExpression(
              [],
              types.callExpression(types.identifier(vars.setCombinedStateVar), [
                types.arrowFunctionExpression(
                  [types.identifier('state')],
                  types.objectExpression([
                    types.spreadElement(types.identifier('state')),
                    types.objectProperty(
                      types.identifier('page'),
                      types.binaryExpression(
                        '+',
                        types.memberExpression(types.identifier('state'), types.identifier('page')),
                        types.numericLiteral(1)
                      )
                    ),
                  ])
                ),
              ])
            )
          )
        )
      )

      nextButton.openingElement.attributes = nextButton.openingElement.attributes.filter(
        (a: any) => a.name?.name !== 'disabled'
      )
      nextButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('disabled'),
          types.jsxExpressionContainer(
            types.binaryExpression(
              '>=',
              types.memberExpression(
                types.identifier(vars.combinedStateVar),
                types.identifier('page')
              ),
              types.identifier(vars.maxPagesStateVar)
            )
          )
        )
      )
    } else {
      nextButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('onClick'),
          types.jsxExpressionContainer(
            types.arrowFunctionExpression(
              [],
              types.callExpression(types.identifier(vars.setPageStateVar), [
                types.arrowFunctionExpression(
                  [types.identifier('page')],
                  types.binaryExpression('+', types.identifier('page'), types.numericLiteral(1))
                ),
              ])
            )
          )
        )
      )

      nextButton.openingElement.attributes = nextButton.openingElement.attributes.filter(
        (a: any) => a.name?.name !== 'disabled'
      )
      nextButton.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('disabled'),
          types.jsxExpressionContainer(
            types.binaryExpression(
              '>=',
              types.identifier(vars.pageStateVar),
              types.identifier(vars.maxPagesStateVar)
            )
          )
        )
      )
    }
  }
}

/**
 * Applies the SERVER cache to the generated data-source modules, once, after
 * every provider has been visited.
 *
 * A post-pass rather than a parameter to `ensureAPIRouteExists` because four
 * different places race to create `utils/data-sources/<file>.js` — the
 * getStaticProps path, the component path, the client-API path and this plugin —
 * and whichever wins would otherwise decide whether the file is cached. Since
 * the generator is deterministic, regenerating the winner with the cache options
 * is order-independent and cannot half-apply.
 *
 * The config is merged per FILE, not per mapper: one module serves every mapper
 * reading that `(type, table, dataSourceId)` triple, so two mappers on two pages
 * have to agree — and the fresher one wins (see `mergeServerCacheOptions`).
 */
function applyServerCacheToDataSourceModules(
  // tslint:disable-next-line:no-any
  extractedResources: any,
  registry: StateRegistry,
  // tslint:disable-next-line:no-any
  dataSources: Record<string, any>,
  transformOptions: EcommerceProductTransformOptions = {},
  // Accumulated across every page/component this generation has processed. The
  // module is shared project-wide, so merging only the CURRENT page's usages
  // would let page ORDER decide the TTL: a page asking for 300s processed after
  // one asking for 60s would widen the window the second page was configured
  // with. Carried on the shared options object so the merge stays global.
  accumulator?: Map<string, { usage: DataSourceUsage; entries: DataSourceServerCacheOptions[] }>
): void {
  const byFileName =
    accumulator ??
    new Map<string, { usage: DataSourceUsage; entries: DataSourceServerCacheOptions[] }>()

  registry.usages.forEach((usage) => {
    if (!usage.cache?.server) {
      return
    }
    const fileName = generateSafeFileName(
      usage.resourceDefinition.dataSourceType,
      usage.resourceDefinition.tableName,
      usage.resourceDefinition.dataSourceId
    )
    const bucket = byFileName.get(fileName) || { usage, entries: [] }
    bucket.entries.push({
      scope: usage.cache.scope,
      ttlSeconds: usage.cache.ttlSeconds,
      sMaxAge: usage.cache.sMaxAge,
      staleWhileRevalidate: usage.cache.staleWhileRevalidate,
    })
    byFileName.set(fileName, bucket)
  })

  byFileName.forEach((bucket, fileName) => {
    const cacheOptions = mergeServerCacheOptions(bucket.entries)
    if (!cacheOptions) {
      return
    }

    const dataSource = dataSources[bucket.usage.resourceDefinition.dataSourceId]
    if (!dataSource) {
      return
    }

    const tableName = bucket.usage.resourceDefinition.tableName || 'data'
    const utilsKey = `utils/${fileName}`
    const apiKey = `api/${fileName}`

    try {
      if (extractedResources[utilsKey]) {
        extractedResources[utilsKey].content = generateDataSourceFetcherWithCore(
          dataSource,
          tableName,
          false,
          transformOptions,
          cacheOptions
        )
        return
      }

      // The variant that inlines the whole fetcher straight into `pages/api`
      // instead of re-exporting a utils module. Detected by content rather than
      // by which code path produced it, so a future fifth emitter is covered too.
      const apiEntry = extractedResources[apiKey]
      if (
        apiEntry &&
        typeof apiEntry.content === 'string' &&
        apiEntry.content.includes('async function handler')
      ) {
        apiEntry.content = generateDataSourceFetcherWithCore(
          dataSource,
          tableName,
          true,
          transformOptions,
          cacheOptions
        )
      }
    } catch (error) {
      // Caching must never be the reason a project fails to generate; the
      // uncached module that is already in place stays exactly as it was.
    }
  })
}

function ensureAPIRouteExists(
  extractedResources: any,
  usage: DataSourceUsage,
  dataSources: Record<string, any>,
  transformOptions: EcommerceProductTransformOptions = {}
): void {
  // Generate file name for the API route
  const fileName = generateSafeFileName(
    usage.resourceDefinition.dataSourceType,
    usage.resourceDefinition.tableName,
    usage.resourceDefinition.dataSourceId
  )

  // Check if the utils data source file exists - if not, create it
  if (!extractedResources[`utils/${fileName}`]) {
    // Get the data source from dataSources
    const dataSource = dataSources[usage.resourceDefinition.dataSourceId]
    if (dataSource) {
      try {
        // Generate the utils file with fetchData, fetchCount, handler, and getCount
        const fetcherCode = generateDataSourceFetcherWithCore(
          dataSource,
          usage.resourceDefinition.tableName || 'data',
          false,
          transformOptions
        )

        extractedResources[`utils/${fileName}`] = {
          fileName,
          fileType: FileType.JS,
          path: ['utils', 'data-sources'],
          content: fetcherCode,
        }
      } catch (error) {
        // If generation fails, skip
        return
      }
    }
  }

  // Now create API routes that re-export from the utils file
  // Create main data API route if not exists
  if (!extractedResources[`api/${fileName}`]) {
    const apiRouteCode = `import dataSourceModule from '../../utils/data-sources/${fileName}'

export default dataSourceModule.handler
`
    extractedResources[`api/${fileName}`] = {
      fileName,
      fileType: FileType.JS,
      path: ['pages', 'api'],
      content: apiRouteCode,
    }
  }

  // Create count API route if not exists (needed for paginated+search cases)
  const countFileName = `${fileName}-count`
  if (!extractedResources[`api/${countFileName}`]) {
    const countApiRouteCode = `import dataSourceModule from '../../utils/data-sources/${fileName}'

export default dataSourceModule.getCount
`
    extractedResources[`api/${countFileName}`] = {
      fileName: countFileName,
      fileType: FileType.JS,
      path: ['pages', 'api'],
      content: countApiRouteCode,
    }
  }
}

function updateGetStaticProps(
  chunks: any[],
  registry: StateRegistry,
  dependencies: Record<string, any>,
  folderPath?: string[]
): void {
  const getStaticPropsChunk = chunks.find((c) => c.name === 'getStaticProps')
  if (!getStaticPropsChunk || getStaticPropsChunk.type !== ChunkType.AST) {
    return
  }

  const content = getStaticPropsChunk.content as types.ExportNamedDeclaration
  if (!content.declaration || content.declaration.type !== 'FunctionDeclaration') {
    return
  }

  const funcBody = content.declaration.body
  const tryStmt = funcBody.body.find((s: any) => s.type === 'TryStatement') as
    | types.TryStatement
    | undefined
  if (!tryStmt) {
    return
  }

  const tryBlock = tryStmt.block

  // Find existing Promise.all
  const promiseAllDecl = tryBlock.body.find(
    (s: any) =>
      s.type === 'VariableDeclaration' &&
      s.declarations?.[0]?.init?.type === 'AwaitExpression' &&
      s.declarations?.[0]?.init?.argument?.type === 'CallExpression' &&
      s.declarations?.[0]?.init?.argument?.callee?.type === 'MemberExpression' &&
      s.declarations?.[0]?.init?.argument?.callee?.object?.name === 'Promise'
  ) as types.VariableDeclaration | undefined

  if (!promiseAllDecl) {
    return
  }

  const declarator = promiseAllDecl.declarations[0] as types.VariableDeclarator
  const awaitExpr = declarator.init as types.AwaitExpression
  const promiseAllCall = awaitExpr.argument as types.CallExpression
  const fetchesArray = promiseAllCall.arguments[0] as types.ArrayExpression

  // Find return statement
  const returnStmt = tryBlock.body.find((s: any) => s.type === 'ReturnStatement') as
    | types.ReturnStatement
    | undefined
  if (!returnStmt || returnStmt.argument?.type !== 'ObjectExpression') {
    return
  }

  const returnObj = returnStmt.argument as types.ObjectExpression
  const propsProperty = returnObj.properties.find(
    (p: any) => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === 'props'
  ) as types.ObjectProperty | undefined

  if (!propsProperty || propsProperty.value.type !== 'ObjectExpression') {
    return
  }

  const propsObj = propsProperty.value as types.ObjectExpression
  const arrayPattern = declarator.id as types.ArrayPattern

  // Track unique data sources for count fetching
  const dataSourcesNeedingCount = new Set<string>()

  // Only process usages that need pagination or search functionality
  // Non-paginated, non-search usages are handled by the main plugin
  registry.usages
    .filter((u) => u.paginated || u.searchEnabled)
    .forEach((usage) => {
      const vars = getStateVarsForUsage(usage)
      const fileName = generateSafeFileName(
        usage.resourceDefinition.dataSourceType,
        usage.resourceDefinition.tableName,
        usage.resourceDefinition.dataSourceId
      )
      // Use consistent import name generation (matches extractDataSourceIntoGetStaticProps)
      const fetcherImportName = StringUtils.dashCaseToCamelCase(fileName)

      // Add fetch call
      const fetchParams: types.ObjectProperty[] = []

      if (usage.paginated) {
        // For paginated array mappers, add page and perPage
        fetchParams.push(types.objectProperty(types.identifier('page'), types.numericLiteral(1)))
        fetchParams.push(
          types.objectProperty(types.identifier('perPage'), types.numericLiteral(usage.perPage))
        )
      } else if (usage.perPage > 0) {
        // For non-paginated array mappers with a limit, add the limit as perPage
        // This ensures the initial data fetch respects the limit from the UIDL
        fetchParams.push(
          types.objectProperty(types.identifier('perPage'), types.numericLiteral(usage.perPage))
        )
      }
      if (usage.queryColumns.length > 0) {
        fetchParams.push(
          types.objectProperty(
            types.identifier('queryColumns'),
            types.callExpression(
              types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
              [types.arrayExpression(usage.queryColumns.map((c) => types.stringLiteral(c)))]
            )
          )
        )
      }

      // Add sorts if present
      if (usage.sorts && usage.sorts.length > 0) {
        fetchParams.push(
          types.objectProperty(
            types.identifier('sorts'),
            types.callExpression(
              types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
              [
                types.arrayExpression(
                  usage.sorts.map((sort: any) =>
                    types.objectExpression([
                      types.objectProperty(
                        types.identifier('field'),
                        types.stringLiteral(sort.field || '')
                      ),
                      types.objectProperty(
                        types.identifier('order'),
                        types.stringLiteral(sort.order || '')
                      ),
                    ])
                  )
                ),
              ]
            )
          )
        )
      }

      // Add filters if present
      // Filter out dynamic destinations for getStaticProps (they can't be resolved at build time)
      const staticFilters = (usage.filters || []).filter(
        (f: any) => !ASTUtils.isUIDLDynamicReference(f.destination)
      )
      if (staticFilters.length > 0) {
        fetchParams.push(
          types.objectProperty(
            types.identifier('filters'),
            types.callExpression(
              types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
              [
                types.arrayExpression(
                  staticFilters.map((filter: any) =>
                    types.objectExpression([
                      types.objectProperty(
                        types.identifier('source'),
                        types.stringLiteral(filter.source || '')
                      ),
                      types.objectProperty(
                        types.identifier('destination'),
                        types.stringLiteral(
                          typeof filter.destination === 'string' ? filter.destination : ''
                        )
                      ),
                      types.objectProperty(
                        types.identifier('operand'),
                        types.stringLiteral(filter.operand || '')
                      ),
                    ])
                  )
                ),
              ]
            )
          )
        )
      }

      // Check if this fetch already exists
      const existingFetchIndex = arrayPattern.elements.findIndex(
        (el: any) => el?.type === 'Identifier' && el.name === vars.propsPrefix
      )

      if (existingFetchIndex === -1) {
        arrayPattern.elements.push(types.identifier(vars.propsPrefix))

        fetchesArray.elements.push(
          types.callExpression(
            types.memberExpression(
              types.callExpression(
                types.memberExpression(
                  types.identifier(fetcherImportName),
                  types.identifier('fetchData')
                ),
                [types.objectExpression(fetchParams)]
              ),
              types.identifier('catch')
            ),
            [
              types.arrowFunctionExpression(
                [types.identifier('error')],
                types.blockStatement([
                  types.expressionStatement(
                    types.callExpression(
                      types.memberExpression(
                        types.identifier('console'),
                        types.identifier('error')
                      ),
                      [
                        types.stringLiteral(`Error fetching ${vars.propsPrefix}:`),
                        types.identifier('error'),
                      ]
                    )
                  ),
                  types.returnStatement(types.arrayExpression([])),
                ])
              ),
            ]
          )
        )

        // Add import dependency for the fetcher
        if (!dependencies[fetcherImportName]) {
          const depth = (folderPath ? folderPath.length : 0) + 1
          const relativePrefix = '../'.repeat(depth)
          dependencies[fetcherImportName] = {
            type: 'local',
            path: `${relativePrefix}utils/data-sources/${fileName}`,
          }
        }

        // Add to props
        propsObj.properties.push(
          types.objectProperty(
            types.identifier(vars.propsPrefix),
            types.identifier(vars.propsPrefix)
          )
        )
      }

      // Track for count fetching
      if (usage.paginated) {
        dataSourcesNeedingCount.add(
          `${usage.resourceDefinition.dataSourceType}:${usage.resourceDefinition.tableName}:${usage.resourceDefinition.dataSourceId}`
        )
      }

      // Add maxPages calculation for paginated
      if (usage.paginated) {
        const maxPagesPropName = `${vars.propsPrefix}_maxPages`
        // Use filter-specific count variable if usage has static filters
        // (dynamic filters can't be resolved at build time)
        const staticFiltersForCount = (usage.filters || []).filter(
          (f: any) => !ASTUtils.isUIDLDynamicReference(f.destination)
        )
        const hasStaticFilters = staticFiltersForCount.length > 0
        const countVarName = hasStaticFilters
          ? `${usage.dataSourceIdentifier}_ds_${usage.index}_count`
          : `${usage.dataSourceIdentifier}_count`

        // Check if maxPages calculation already exists
        const existingMaxPages = tryBlock.body.find(
          (s: any) =>
            s.type === 'VariableDeclaration' && s.declarations?.[0]?.id?.name === maxPagesPropName
        )

        if (!existingMaxPages) {
          // Insert maxPages calculation before return
          const returnIndex = tryBlock.body.indexOf(returnStmt)
          tryBlock.body.splice(
            returnIndex,
            0,
            types.variableDeclaration('const', [
              types.variableDeclarator(
                types.identifier(maxPagesPropName),
                types.callExpression(
                  types.memberExpression(types.identifier('Math'), types.identifier('ceil')),
                  [
                    types.binaryExpression(
                      '/',
                      types.logicalExpression(
                        '||',
                        types.identifier(countVarName),
                        types.numericLiteral(0)
                      ),
                      types.numericLiteral(usage.perPage)
                    ),
                  ]
                )
              ),
            ])
          )

          // Add maxPages to props
          propsObj.properties.push(
            types.objectProperty(
              types.identifier(maxPagesPropName),
              types.identifier(maxPagesPropName)
            )
          )
        }
      }
    })

  // Add count fetches for unique data sources
  // Group usages by filters to determine which need separate count fetches
  const processedCountKeys = new Set<string>()

  dataSourcesNeedingCount.forEach((key) => {
    const [dataSourceType, tableName, dataSourceId] = key.split(':')
    const fileName = generateSafeFileName(dataSourceType, tableName, dataSourceId)
    const fetcherImportName = StringUtils.dashCaseToCamelCase(fileName)

    // Find all paginated usages for this data source
    const usagesForDataSource = registry.usages.filter(
      (u) =>
        u.resourceDefinition.dataSourceId === dataSourceId &&
        u.resourceDefinition.tableName === tableName &&
        u.paginated
    )

    if (usagesForDataSource.length === 0) {
      return
    }

    // Group usages by their filters (stringify for comparison)
    const usagesByFilters = new Map<string, DataSourceUsage[]>()
    for (const usage of usagesForDataSource) {
      const filtersKey = JSON.stringify(usage.filters || [])
      const existing = usagesByFilters.get(filtersKey) || []
      existing.push(usage)
      usagesByFilters.set(filtersKey, existing)
    }

    // Generate count fetches for each unique filter configuration
    usagesByFilters.forEach((usages, filtersKey) => {
      const firstUsage = usages[0]
      // Filter out dynamic destinations for getStaticProps (they can't be resolved at build time)
      const staticFiltersForCount = (firstUsage.filters || []).filter(
        (f: any) => !ASTUtils.isUIDLDynamicReference(f.destination)
      )
      const hasStaticFilters = staticFiltersForCount.length > 0

      // Create unique count variable name based on filters
      const countVarName = hasStaticFilters
        ? `${firstUsage.dataSourceIdentifier}_ds_${firstUsage.index}_count`
        : `${firstUsage.dataSourceIdentifier}_count`

      // Check if this count was already processed
      const countKey = `${key}:${filtersKey}`
      if (processedCountKeys.has(countKey)) {
        return
      }
      processedCountKeys.add(countKey)

      // Check if count fetch already exists
      const existingCount = arrayPattern.elements.findIndex(
        (el: any) => el?.type === 'Identifier' && el.name === countVarName
      )

      if (existingCount === -1) {
        arrayPattern.elements.push(types.identifier(countVarName))

        // Build count params if static filters exist
        const countParams: types.ObjectProperty[] = []
        if (hasStaticFilters) {
          countParams.push(
            types.objectProperty(
              types.identifier('filters'),
              types.callExpression(
                types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
                [
                  types.arrayExpression(
                    staticFiltersForCount.map((f: any) =>
                      types.objectExpression([
                        types.objectProperty(
                          types.identifier('source'),
                          types.stringLiteral(f.source || '')
                        ),
                        types.objectProperty(
                          types.identifier('destination'),
                          types.stringLiteral(
                            typeof f.destination === 'string' ? f.destination : ''
                          )
                        ),
                        types.objectProperty(
                          types.identifier('operand'),
                          types.stringLiteral(f.operand || '')
                        ),
                      ])
                    )
                  ),
                ]
              )
            )
          )
        }

        fetchesArray.elements.push(
          types.callExpression(
            types.memberExpression(
              types.callExpression(
                types.memberExpression(
                  types.identifier(fetcherImportName),
                  types.identifier('fetchCount')
                ),
                countParams.length > 0 ? [types.objectExpression(countParams)] : []
              ),
              types.identifier('catch')
            ),
            [
              types.arrowFunctionExpression(
                [types.identifier('error')],
                types.blockStatement([
                  types.expressionStatement(
                    types.callExpression(
                      types.memberExpression(
                        types.identifier('console'),
                        types.identifier('error')
                      ),
                      [
                        types.stringLiteral(`Error fetching ${countVarName}:`),
                        types.identifier('error'),
                      ]
                    )
                  ),
                  types.returnStatement(types.numericLiteral(0)),
                ])
              ),
            ]
          )
        )

        // Store which usages use this count variable for maxPages calculation
        for (const usage of usages) {
          // tslint:disable-next-line:no-any
          ;(usage as any).countVarName = countVarName
        }

        // Add import dependency for the fetcher
        if (!dependencies[fetcherImportName]) {
          const depth = (folderPath ? folderPath.length : 0) + 1
          const relativePrefix = '../'.repeat(depth)
          dependencies[fetcherImportName] = {
            type: 'local',
            path: `${relativePrefix}utils/data-sources/${fileName}`,
          }
        }
      }
    })
  })
}
