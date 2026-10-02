/**
 * Rows per page a paginated list gets when its UIDL names none: the editor's
 * own default (`DEFAULT_ARRAY_MAPPER_PER_PAGE`), which is also what the canvas
 * pages by.
 */
export const DEFAULT_REPEATER_PER_PAGE = 10

/**
 * The page size of a paginated `cms-list-repeater`: its `perPage` when that is
 * a whole positive number, else the editor's default.
 *
 * ⛔ A paginated list without a usable page size used to take the whole project
 * down with it ("Property value expected type of number but got undefined"),
 * and a NaN one paged nothing — while the canvas showed ten rows per page.
 */
export const resolveRepeaterPerPage = (perPage: unknown): number => {
  const parsed =
    typeof perPage === 'number'
      ? perPage
      : typeof perPage === 'string'
      ? parseInt(perPage, 10)
      : NaN
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : DEFAULT_REPEATER_PER_PAGE
}
