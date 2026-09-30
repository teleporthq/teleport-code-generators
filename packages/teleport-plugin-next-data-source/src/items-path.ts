import * as types from '@babel/types'

/**
 * Where a paginated/searchable list's rows sit inside the payload its data
 * source returns, read off the repeater's `source` expression.
 *
 * A REST API or JavaScript source may answer `{ templates: [...], total }`, and
 * the editor binds the list to `All_Templates_data_data?.templates || []`. The
 * generated fetcher only searches, filters, sorts and slices a payload that IS
 * an array, so without this every row came back on every page (the canvas
 * slices on the client and looked right) and the count measured the wrapper as
 * 0 rows, disabling "Next".
 *
 * Returns undefined when the list is bound to the payload itself, or when the
 * source is anything other than a plain property chain off the data source's
 * render prop — an expression this cannot read is left exactly as before.
 */
const SEGMENT_RE =
  /^(?:\?\.([A-Za-z_$][\w$]*)|\.([A-Za-z_$][\w$]*)|(?:\?\.)?\[\s*(?:"([^"]*)"|'([^']*)')\s*\])/

const PATH_AWARE_SOURCE_TYPES = new Set(['rest-api', 'javascript'])

export const extractItemsPath = (
  source: unknown,
  dataSourceIdentifier: string,
  dataSourceType: string
): string[] | undefined => {
  if (typeof source !== 'string' || !dataSourceIdentifier) {
    return undefined
  }
  if (!PATH_AWARE_SOURCE_TYPES.has(dataSourceType)) {
    return undefined
  }

  let rest = source
    .trim()
    .replace(/\s*\|\|\s*\[\s*\]$/, '')
    .trim()
  if (!rest.startsWith(dataSourceIdentifier)) {
    return undefined
  }
  rest = rest.slice(dataSourceIdentifier.length)

  const path: string[] = []
  while (rest.length > 0) {
    const match = rest.match(SEGMENT_RE)
    if (!match) {
      return undefined
    }
    path.push(match[1] ?? match[2] ?? match[3] ?? match[4])
    rest = rest.slice(match[0].length)
  }

  return path.length > 0 ? path : undefined
}

/**
 * Push `<key>: '["templates"]'` onto a params object. Fetch calls send it as
 * `itemsPath` (process the inner array, keep the wrapper the page reads back
 * through); count calls send it as `collectionPath`, so the count handler
 * measures the inner array instead of the wrapper.
 */
export const appendItemsPathParam = (
  paramsProps: types.ObjectProperty[],
  itemsPath: string[] | undefined,
  key: 'itemsPath' | 'collectionPath'
): void => {
  if (!itemsPath || itemsPath.length === 0) {
    return
  }
  paramsProps.push(
    types.objectProperty(types.identifier(key), types.stringLiteral(JSON.stringify(itemsPath)))
  )
}
