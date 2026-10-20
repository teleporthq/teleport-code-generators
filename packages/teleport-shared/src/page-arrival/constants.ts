/**
 * Where the generated page-arrival wrapper lives and what pages import it as.
 *
 * Lives in `teleport-shared` because two page plugins in two packages ask for
 * it — the workflows plugin (page-load and element-visible triggers) and the
 * state data-source plugin (state seeded from a data source) — and they must
 * emit the same file under the same name.
 */

/** Folder of the emitted runtime, relative to the generated project root. */
export const PAGE_ARRIVAL_DIR = ['utils']
export const PAGE_ARRIVAL_FILE_NAME = 'page-arrival'

/** The default export of the runtime, as the page module imports it. */
export const PAGE_ARRIVAL_WRAPPER = 'remountOnPageArrival'
