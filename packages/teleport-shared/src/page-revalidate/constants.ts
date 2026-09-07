/**
 * Shared constants for the generated page-revalidation route.
 *
 * Lives in `teleport-shared` because two generators agree on them — the Next
 * project plugin that emits the route and the `page-revalidate` workflow node
 * that calls it — and a mismatch would be a 404 the node reports only as a
 * warning, so nothing would ever fail loudly.
 */

/** Emitted API route, relative to the generated project root. */
export const REVALIDATE_API_DIR = ['pages', 'api']
export const REVALIDATE_ROUTE = 'tq-revalidate'

/** The path the workflow node POSTs to. Kept beside the emitted route's name. */
export const REVALIDATE_ROUTE_PATH = '/api/tq-revalidate'

/**
 * One request may not rebuild more than this many pages.
 *
 * Each path re-runs `getStaticProps`, so an unbounded list is an unbounded
 * serverless invocation triggered by whatever the workflow put in the config.
 * Every wiring the platform generates asks for one or two paths.
 */
export const REVALIDATE_MAX_PATHS = 20
