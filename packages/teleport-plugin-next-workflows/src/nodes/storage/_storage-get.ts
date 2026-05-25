// Shared body for the storage-{local,session}-get handlers.
//
// Both nodes do the same work — read a slot from a storage backend, JSON-
// parse if possible, fall back to the raw string otherwise, and return a
// schema-shaped envelope. The two only differ in WHICH backend they hit
// (`localStorage` vs `sessionStorage`), so we extract everything else.
//
// Schema contract for both nodes is `{ value, key, exists }`:
//   - value:  the parsed slot contents (or defaultValue when the slot
//             didn't exist or the storage API was unavailable)
//   - key:    the configured key the user typed in the editor (echoed back
//             so workflows can carry it forward without re-resolving)
//   - exists: true iff the storage API returned a non-null value (empty
//             string IS a real value and counts as existing — only `null`
//             from `getItem` means the key was absent)
//
// We assemble the body via plain string concatenation so the storage backend
// identifier can be swapped without backtick interpolation.

const buildStorageGetBody = (storageBackend: string): string => {
  return [
    '  const key = config.key;',
    '  const defaultValue = config.defaultValue !== undefined ? config.defaultValue : null;',
    '  try {',
    '    const raw = ' + storageBackend + '.getItem(key);',
    '    if (raw === null) {',
    '      return { value: defaultValue, key: key, exists: false };',
    '    }',
    '    try {',
    '      const parsed = JSON.parse(raw);',
    '      return { value: parsed, key: key, exists: true };',
    '    } catch (e) {',
    '      return { value: raw, key: key, exists: true };',
    '    }',
    '  } catch (err) {',
    '    return { value: defaultValue, key: key, exists: false };',
    '  }',
  ].join('\n')
}

/**
 * Build the source string for a storage-get handler. `storageBackend` is the
 * identifier expression that resolves to the storage object inside the
 * generated handler body — e.g. `localStorage` or `sessionStorage`.
 * `symbolName` becomes the function declaration's name (must match the
 * underscore-cased convention codegen elsewhere assumes).
 */
export const buildStorageGetHandlerSource = (
  symbolName: string,
  storageBackend: string
): string => {
  return (
    'async function ' +
    symbolName +
    '(config, context) {\n' +
    buildStorageGetBody(storageBackend) +
    '\n}'
  )
}
