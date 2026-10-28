import * as types from '@babel/types'
import {
  ChunkDefinition,
  ChunkType,
  ComponentPlugin,
  ComponentPluginFactory,
} from '@teleporthq/teleport-types'
import { RouteUtils } from '@teleporthq/teleport-plugin-common'

const SKIP_WALK_KEYS = new Set([
  'loc',
  'range',
  'start',
  'end',
  'leadingComments',
  'trailingComments',
])

/**
 * Recursively strips a `revalidate` property from every `return { ... }`
 * object literal reachable from `node`. ISR's `revalidate` is meaningless
 * (and a hard Next.js build error — "Additional keys were returned from
 * getServerSideProps") once a page has been converted to
 * getServerSideProps, but several upstream page plugins (data-source,
 * inline-fetch, pagination, state-data-source) unconditionally attach one
 * when they first CREATE the getStaticProps chunk. Walking generically
 * (rather than only the single return statement `generateInitialPropsAST`
 * itself emits) catches every one of those regardless of which plugin
 * added it or how deeply nested inside try/catch or if-branches it is.
 */
function stripRevalidateFromReturns(node: unknown): void {
  if (!node || typeof node !== 'object') {
    return
  }
  const anyNode = node as Record<string, unknown> & { type?: string }

  if (
    anyNode.type === 'ReturnStatement' &&
    (anyNode.argument as { type?: string } | undefined)?.type === 'ObjectExpression'
  ) {
    const objectExpression = anyNode.argument as types.ObjectExpression
    objectExpression.properties = objectExpression.properties.filter((property) => {
      return !(
        property.type === 'ObjectProperty' &&
        property.key.type === 'Identifier' &&
        property.key.name === 'revalidate'
      )
    })
  }

  for (const key of Object.keys(anyNode)) {
    if (SKIP_WALK_KEYS.has(key)) continue
    const value = anyNode[key]
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof (child as { type?: string }).type === 'string') {
          stripRevalidateFromReturns(child)
        }
      }
    } else if (value && typeof (value as { type?: string }).type === 'string') {
      stripRevalidateFromReturns(value)
    }
  }
}

// The keys getServerSideProps' context has and getStaticProps' never had.
const REQUEST_ONLY_CONTEXT_KEYS = ['req', 'res', 'query', 'resolvedUrl']

/**
 * Rewrites every `...context` spread (the data function's own parameter) into
 * a spread of the context WITHOUT the request: the locale fetcher's
 * getStaticProps returns `props: { messages, ...context }`, and on a
 * getServerSideProps context that would hand `req` / `res` to the props
 * serializer — a page that cannot render. What is left is exactly what
 * getStaticProps received (params, locale, locales, defaultLocale, preview).
 */
function omitRequestFromContextSpreads(node: unknown, contextName: string): void {
  if (!node || typeof node !== 'object') {
    return
  }
  const anyNode = node as Record<string, unknown> & { type?: string }

  if (
    anyNode.type === 'SpreadElement' &&
    (anyNode.argument as types.Node | undefined)?.type === 'Identifier' &&
    (anyNode.argument as types.Identifier).name === contextName
  ) {
    const rest = types.identifier('rest')
    anyNode.argument = types.callExpression(
      types.arrowFunctionExpression(
        [
          types.objectPattern([
            ...REQUEST_ONLY_CONTEXT_KEYS.map((key) =>
              types.objectProperty(types.identifier(key), types.identifier(key), false, true)
            ),
            types.restElement(rest),
          ]),
        ],
        rest
      ),
      [types.identifier(contextName)]
    )
    return
  }

  for (const key of Object.keys(anyNode)) {
    if (SKIP_WALK_KEYS.has(key)) continue
    const value = anyNode[key]
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof (child as { type?: string }).type === 'string') {
          omitRequestFromContextSpreads(child, contextName)
        }
      }
    } else if (value && typeof (value as { type?: string }).type === 'string') {
      omitRequestFromContextSpreads(value, contextName)
    }
  }
}

/**
 * Turns a page's `getStaticProps` chunk into `getServerSideProps`: renames the
 * function and the chunk, strips every `revalidate` (a build error there) and
 * keeps the request out of the props. False when the chunk is not the
 * `export async function getStaticProps(context)` shape every page plugin
 * writes, and nothing was changed.
 */
export const convertToServerSideProps = (chunk: ChunkDefinition): boolean => {
  if (chunk.type !== ChunkType.AST) {
    return false
  }
  const exportDeclaration = chunk.content as types.ExportNamedDeclaration
  const functionDeclaration = exportDeclaration?.declaration
  if (!functionDeclaration || functionDeclaration.type !== 'FunctionDeclaration') {
    return false
  }

  functionDeclaration.id = types.identifier('getServerSideProps')
  chunk.name = 'getServerSideProps'
  stripRevalidateFromReturns(functionDeclaration.body)
  const contextParam = functionDeclaration.params[0]
  if (contextParam && contextParam.type === 'Identifier') {
    omitRequestFromContextSpreads(functionDeclaration.body, contextParam.name)
  }
  return true
}

/**
 * Tail-of-pipeline finalizer for entity-bound pages that
 * `createStaticPropsPlugin` (teleport-plugin-next-static-props) tagged with
 * `meta.useServerSideProps` on the 'getStaticProps' chunk — i.e. dynamic
 * pages that read one specific row AND have a same-page workflow that
 * writes to that same table (see `pageHasSameTableMutationWorkflow`'s doc in
 * that package for why this is a data-correctness signal, independent of
 * the project's visual nav layout) — and for every page that reads a money
 * table (`pageReadsProtectedTable`), whose getStaticProps chunk is usually
 * created by the data-source or pagination plugin, which never tag it — and
 * for every page that seeds a state from a data source
 * (`pageSeedsStateFromDataSource`), whose values must be computed on each
 * arrival rather than served from a static snapshot.
 *
 * Every OTHER page plugin that fetches data (inline-fetch, data-source,
 * pagination, state-data-source, locale-fetcher) finds / merges additional
 * fetches into that chunk by its literal name `'getStaticProps'` — so the
 * chunk MUST keep that name for the entire per-page plugin pipeline, or
 * every one of those lookups would miss and each would spawn its OWN
 * second, conflicting `getStaticProps` function on the same page. This
 * plugin is registered LAST (after every data-fetching plugin) and performs
 * the actual getStaticProps -> getServerSideProps conversion once nothing
 * downstream needs to find the chunk by its original name:
 *   1. Renames the function identifier + the chunk itself.
 *   2. Strips any `revalidate` property later plugins attached (invalid on
 *      getServerSideProps — Next.js throws a build-time error if present).
 */
export const createEntityMutationSsrFinalizerPlugin: ComponentPluginFactory<
  Record<string, never>
> = () => {
  const entityMutationSsrFinalizerPlugin: ComponentPlugin = async (structure) => {
    const { chunks, uidl, options } = structure
    const rendersPerRequest =
      RouteUtils.pageReadsProtectedTable(uidl) ||
      RouteUtils.pageSeedsStateFromDataSource(uidl, options?.dataSources)
    const getStaticPropsChunk = chunks.find(
      (chunk) =>
        chunk.name === 'getStaticProps' &&
        (chunk.meta?.useServerSideProps === true || rendersPerRequest)
    )
    if (getStaticPropsChunk) {
      convertToServerSideProps(getStaticPropsChunk)
    }

    return structure
  }

  return entityMutationSsrFinalizerPlugin
}

export default createEntityMutationSsrFinalizerPlugin()
