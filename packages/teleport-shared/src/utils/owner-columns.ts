import { OWNER_COLUMN_SOURCES } from './owner-columns-sources.generated'

/**
 * Which column makes a row the signed-in visitor's.
 *
 * The single source for that decision, read on both sides of a row's life.
 * The AI pipeline (teleport-services-worker) scopes a "My …" page to the
 * visitor through the column `resolveOwnerColumn` names; the generated
 * account-delete route (teleport-plugin-next-workflows) deletes a visitor's
 * rows from the project's own tables through that same column when they close
 * their account. The two must agree in BOTH directions. A column the route
 * deletes by that the page does not read by deletes somebody else's rows. A
 * column the page reads by that the route skips leaves rows that outlive the
 * account with a blank owner — the link is `ON DELETE SET NULL` — and the
 * page, reading `owner = me OR owner IS NULL`, then shows them to every other
 * signed-in visitor.
 *
 * A table is attributed through exactly ONE column:
 *   1. the first present of the priority names (`user_id`, `owner_id`,
 *      `member_id`, `account_id`, `customer_id`, `created_by`), else
 *   2. the first `<role>_user_id` column in column order — the pipeline names
 *      the signed-in account that way (`author_user_id`, `approved_by_user_id`), else
 *   3. the first attribution column in column order (`author_id`, `owned_by`,
 *      `submitted_by`, `assigned_to`, `updated_by` …).
 *
 * The resolved column has a KIND. An `owner` column names the visitor the row
 * is about: its author, creator, submitter, sender. An `actor` column names a
 * visitor who acted on somebody else's row: its approver, reviewer, assignee,
 * editor, recipient. A per-user page may read through either; account
 * deletion deletes only through an `owner` column, because deleting through
 * an `actor` column would delete other people's rows.
 *
 * The four functions ship as TEXT inside generated projects
 * (scripts/function-sources.js writes owner-columns-sources.generated.ts), so
 * they are self-contained: plain ES5, no module-level references, each
 * calling the others by name.
 */
export type OwnerColumnKind = 'owner' | 'actor'

export interface OwnerColumnCandidate {
  name: string
  /** 1-based position in the table, as information_schema reports it. */
  ordinalPosition: number
}

export interface ResolvedOwnerColumn {
  /** The column as it is spelled in the table. */
  column: string
  kind: OwnerColumnKind
}

/** The exact names, in the order in which the first present one wins. */
export function ownerColumnPriority(): string[] {
  return ['user_id', 'owner_id', 'member_id', 'account_id', 'customer_id', 'created_by']
}

/** The `<role>` of a `<role>_user_id` column, or null when `name` is not one. */
export function userIdRole(name: string): string | null {
  const normalized = String(name).trim().toLowerCase()
  const suffix = '_user_id'
  if (normalized.length <= suffix.length || normalized.slice(-suffix.length) !== suffix) {
    return null
  }
  return normalized.slice(0, -suffix.length)
}

/**
 * Whether `name` attributes a row to a visitor, and as what; null when it does
 * not. An `owner` name says whose the row is; an `actor` name says who acted on
 * it.
 *
 * A `<verb>_by` name — plain, or as the role of a `<verb>_by_user_id` column —
 * is an owner only when the verb is one that brings the row into being
 * (`created_by`, `submitted_by`, `sent_by_user_id`) and an actor for every
 * other verb (`approved_by`, `changed_by_user_id`, `closed_by`, `handled_by`):
 * the pipeline names "who created, submitted, approved or changed a row" this
 * way, and only the first two make the row theirs. The verb is the word right
 * before `by` (`last_edited_by_user_id` → `edited`). A plain `<word>_by` whose
 * word arranges the rows (`sort_by`, `order_by`, `group_by`) names nobody.
 *
 * Any other `<role>_user_id` column is an actor when its role carries an
 * acting word (`reviewer`, `recipient`, `assignee`), an owner otherwise
 * (`author`, `sender`, `submitter`).
 */
export function attributionKind(name: string): OwnerColumnKind | null {
  const normalized = String(name).trim().toLowerCase()
  const owners = ownerColumnPriority().concat(['author_id', 'creator_id'])
  if (owners.indexOf(normalized) !== -1) {
    return 'owner'
  }
  const actors = ['assigned_to', 'assignee_id']
  if (actors.indexOf(normalized) !== -1) {
    return 'actor'
  }
  const role = userIdRole(normalized)
  const words = (role === null ? normalized : role).split('_')
  if (words.length >= 2 && words[words.length - 1] === 'by' && words[words.length - 2] !== '') {
    /** These name how rows are arranged, never who acted. */
    const arrangementWords = ['sort', 'order', 'group', 'filter', 'partition', 'rank']
    if (role === null && arrangementWords.indexOf(words[words.length - 2]) !== -1) {
      return null
    }
    const creationVerbs = [
      'created',
      'submitted',
      'posted',
      'authored',
      'uploaded',
      'added',
      'requested',
      'sent',
      'booked',
      'ordered',
      'placed',
      'reported',
      'owned',
    ]
    return creationVerbs.indexOf(words[words.length - 2]) !== -1 ? 'owner' : 'actor'
  }
  if (role === null) {
    return null
  }
  const actingWords = [
    'assigned',
    'assignee',
    'approved',
    'approver',
    'reviewed',
    'reviewer',
    'updated',
    'edited',
    'editor',
    'modified',
    'deleted',
    'recipient',
    'receiver',
    'to',
  ]
  for (let i = 0; i < words.length; i++) {
    if (actingWords.indexOf(words[i]) !== -1) {
      return 'actor'
    }
  }
  return 'owner'
}

/** The one column a table is attributed through, and as what; null when none. */
export function resolveOwnerColumn(columns: OwnerColumnCandidate[]): ResolvedOwnerColumn | null {
  const ordered = columns.slice().sort((a, b) => a.ordinalPosition - b.ordinalPosition)
  const names = ordered.map((column) => String(column.name).trim().toLowerCase())
  const priority = ownerColumnPriority()
  for (let i = 0; i < priority.length; i++) {
    const at = names.indexOf(priority[i])
    if (at !== -1) {
      return { column: ordered[at].name, kind: 'owner' }
    }
  }
  for (let j = 0; j < names.length; j++) {
    if (userIdRole(names[j]) !== null) {
      return { column: ordered[j].name, kind: attributionKind(names[j]) || 'owner' }
    }
  }
  for (let k = 0; k < names.length; k++) {
    const kind = attributionKind(names[k])
    if (kind !== null) {
      return { column: ordered[k].name, kind }
    }
  }
  return null
}

/** The resolver and its helpers as one block of plain JS, for a generated route. */
export const generateOwnerColumnResolverCode = (): string =>
  [
    OWNER_COLUMN_SOURCES.ownerColumnPriority,
    OWNER_COLUMN_SOURCES.userIdRole,
    OWNER_COLUMN_SOURCES.attributionKind,
    OWNER_COLUMN_SOURCES.resolveOwnerColumn,
  ].join('\n\n')

export { OWNER_COLUMN_SOURCES }
