/**
 * Which column of a table names the visitor who owns the row.
 *
 * Two readers must agree on it. The AI pipeline (teleport-services-worker,
 * `per-user-page-scoping.ts`) scopes a "My …" page to the signed-in visitor
 * through the first of these columns a table carries; the generated
 * account-delete route (teleport-plugin-next-workflows) deletes a visitor's
 * rows from the project's own tables through the same columns when they close
 * their account. A column one side treats as the owner and the other does not
 * leaves rows that outlive the account with a blank owner — the owner link is
 * `ON DELETE SET NULL` — and the page, reading `owner = me OR owner IS NULL`,
 * then shows them to every other signed-in visitor.
 *
 * The exact names come first, in the pipeline's priority order (the first
 * present column scopes the page), then the `<entity>_user_id` convention
 * (`owner_user_id`, `author_user_id`). Actor and audit links — `assigned_to`,
 * `updated_by`, `approved_by` — are NOT owner columns: they name someone else's
 * part in the row, and deleting on them would delete other people's rows.
 */
export const OWNER_COLUMN_NAMES: ReadonlyArray<string> = [
  'user_id',
  'owner_id',
  'member_id',
  'account_id',
  'customer_id',
  'created_by',
]

/** `<entity>_user_id` — a direct ownership link by convention. */
export const OWNER_COLUMN_SUFFIX = '_user_id'

export const isOwnerColumn = (name: string): boolean => {
  const normalized = String(name).trim().toLowerCase()
  if (OWNER_COLUMN_NAMES.indexOf(normalized) !== -1) {
    return true
  }
  return normalized.slice(-OWNER_COLUMN_SUFFIX.length) === OWNER_COLUMN_SUFFIX
}
