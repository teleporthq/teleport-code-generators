/**
 * Shared constants for the array-mapper pagination scroll behaviour.
 *
 * Two halves of the same contract live apart: `uidl-markers` stamps the
 * `data-*` attributes onto the UIDL, and `pagination-scroll-runtime` emits the
 * browser code that reads them back. Keeping the strings here is what stops the
 * two from drifting into a runtime that silently matches nothing.
 */

/**
 * UIDL element type of the container the GUI adds under a paginated array
 * mapper. It holds the previous/next `cms-navigation-button`s that
 * `teleport-plugin-next-data-source` wires to the mapper's page state.
 */
export const PAGINATION_ELEMENT_TYPE = 'cms-pagination-node'

/**
 * UIDL element type of the search / sort / filter block an array mapper renders
 * ABOVE its rows. It is a sibling of the rows in the DOM, so the runtime has to
 * be able to tell it apart from the first row — see `LIST_CHROME_ATTR`.
 */
export const LIST_CONTROLS_ELEMENT_TYPE = 'data-source-search-node'

/** Marks the pagination container. The runtime delegates off this attribute. */
export const PAGINATION_ATTR = 'data-tq-pagination'

/**
 * Marks a sibling of the mapper's rows that is CHROME rather than a row, so the
 * runtime skips it when it looks for the first item to scroll to.
 */
export const LIST_CHROME_ATTR = 'data-tq-list-chrome'

/** Emitted runtime path, relative to the generated project root. */
export const PAGINATION_SCROLL_RUNTIME_DIR = ['utils']
export const PAGINATION_SCROLL_RUNTIME_MODULE = 'pagination-scroll'

/** Side-effect import spliced into `pages/_app`. */
export const PAGINATION_SCROLL_IMPORT = `import '../${PAGINATION_SCROLL_RUNTIME_DIR.join(
  '/'
)}/${PAGINATION_SCROLL_RUNTIME_MODULE}'`
