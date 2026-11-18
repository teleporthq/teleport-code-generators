import { ContentTables } from '@teleporthq/teleport-shared'

/** The forum tables the feed (`/forum`) and the directory (`/forum/communities`) bind. */
export const FORUM_FEED_TABLES: ReadonlyArray<string> = [
  ContentTables.FORUM_TABLES.topics,
  ContentTables.FORUM_TABLES.communities,
]

export const isForumFeedTable = (tableName: string): boolean =>
  FORUM_FEED_TABLES.indexOf(tableName) !== -1

/**
 * The forum feed and directory rows, as the topic and community cards bind
 * them. The row is kept whole (every column, snake_case); what a card shows
 * beyond the columns is derived here:
 *
 * - a topic: `excerpt` (the first 240 characters of `body_text`), `is_solved`
 *   (an accepted answer), `is_answered` (any reply), `tag_list` (the JSON
 *   `tags` column as an array), `author_initials`, and `community_name` as
 *   `community_slug` when the row has none of its own (written before the
 *   column existed);
 * - a community: `excerpt` (of the description), `is_private`, `initials`,
 *   `rule_list` (the JSON `rules` column as an array) and `rules_text` (one
 *   rule per line, what the manage page's form shows).
 *
 * The fields the pages bind are listed in the editor's
 * `features/forum/constants/forum-shapes.ts`.
 *
 * Nothing is filtered: the read route's visitor row policy
 * (`ContentTables.FORUM_VISITOR_ROW_POLICIES`) already decided which rows a
 * browser is served. The forum data module gives the same fields to the rows
 * of a topic or community page.
 *
 * MUST mirror `buildForumFeedRow` in the editor
 * (teleport-gui `packages/renderer/src/utils/forum-feed.ts`), which is what
 * the canvas renders from.
 */
export const generateForumFeedTransformationCode = (): string => `
// ============================================================
// Forum Feed Transformation
// ============================================================

var FORUM_EXCERPT_LENGTH = 240

function forumExcerpt(value) {
  var words = String(value == null ? '' : value).replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim()
  if (words.length <= FORUM_EXCERPT_LENGTH) return words
  return words.slice(0, FORUM_EXCERPT_LENGTH).replace(/\\s+\\S*$/, '') + '…'
}

function forumInitials(name) {
  return String(name == null ? '' : name)
    .trim()
    .split(/\\s+/)
    .filter(Boolean)
    .map(function (word) { return word.charAt(0) })
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function forumJsonList(value) {
  if (Array.isArray(value)) return value
  try {
    var parsed = JSON.parse(String(value == null || value === '' ? '[]' : value))
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return []
  }
}

// The rules column as the manage form's textarea shows it: one rule per line, "title: text".
function forumRulesText(rules) {
  return forumJsonList(rules)
    .map(function (rule) {
      if (!rule || typeof rule !== 'object') return ''
      var title = String(rule.title == null ? '' : rule.title).trim()
      var body = String(rule.text == null ? '' : rule.text).trim()
      return title && body ? title + ': ' + body : title || body
    })
    .filter(Boolean)
    .join('\\n')
}

function buildForumFeedRow(record) {
  if (!record || typeof record !== 'object') return record
  var out = {}
  for (var key in record) {
    if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key]
  }
  // A community row has a visibility; a topic row an author.
  if ('visibility' in record && !('author_id' in record)) {
    out.excerpt = forumExcerpt(record.description)
    out.is_private = record.visibility === 'private'
    out.initials = forumInitials(record.name)
    out.rule_list = forumJsonList(record.rules).filter(function (rule) { return rule && typeof rule === 'object' })
    out.rules_text = forumRulesText(record.rules)
    return out
  }
  out.excerpt = forumExcerpt(record.body_text)
  out.is_solved = !!record.accepted_reply_id
  out.is_answered = safeNumber(record.reply_count, 0) > 0
  out.tag_list = forumJsonList(record.tags).filter(function (tag) { return typeof tag === 'string' })
  out.author_initials = forumInitials(record.author_name)
  if (record.community_name == null || record.community_name === '') {
    out.community_name = record.community_slug == null ? '' : record.community_slug
  }
  return out
}

function transformForumFeed(records) {
  if (!Array.isArray(records)) return []
  return records.map(buildForumFeedRow)
}
`
