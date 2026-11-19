import { SessionCookieResolver } from '@teleporthq/teleport-shared'
import { generateLazyPgClientCode } from '@teleporthq/teleport-plugin-next-workflows'
import { toJsLiteral } from '../pwa/source-literals'
import { FORUM_SEO_RUNTIME } from './seo'
import { ForumConfig, FORUM_TABLES } from './settings'
import { FORUM_MARKDOWN_MODULE_NAME } from './markdown-source'

export const FORUM_PAGE_DATA_MODULE_PATH = ['utils']
export const FORUM_PAGE_DATA_MODULE_NAME = 'forum-page-data'

/** How many replies one read of the tree or of `/api/plugins/forum/replies` takes. */
export const FORUM_REPLIES_PAGE = 50
const TOPIC_COLUMNS = [
  'id',
  'community_id',
  'community_slug',
  'community_name',
  'community_visibility',
  'author_id',
  'author_handle',
  'author_name',
  'author_avatar',
  'title',
  'slug',
  'body',
  'body_text',
  'tags',
  'attachments',
  'status',
  'is_pinned',
  'is_locked',
  'accepted_reply_id',
  'score',
  'upvotes',
  'downvotes',
  'reply_count',
  'view_count',
  'last_activity_at',
  'edited_at',
  'removed_reason',
  'created_at',
  'updated_at',
]
const REPLY_COLUMNS = [
  'id',
  'topic_id',
  'community_id',
  'parent_id',
  'depth',
  'path',
  'author_id',
  'author_handle',
  'author_name',
  'author_avatar',
  'body',
  'body_text',
  'attachments',
  'status',
  'score',
  'upvotes',
  'downvotes',
  'is_accepted',
  'quote_of',
  'edited_at',
  'removed_reason',
  'created_at',
  'updated_at',
]
const COMMUNITY_COLUMNS = [
  'id',
  'slug',
  'name',
  'description',
  'rules',
  'icon_url',
  'banner_url',
  'kind',
  'visibility',
  'posting',
  'status',
  'created_by',
  'member_count',
  'topic_count',
  'last_activity_at',
  'is_featured',
  'sort_order',
  'created_at',
  'updated_at',
]
/** The public columns of a member's forum profile: never an e-mail, never a note. */
const PROFILE_COLUMNS = [
  'user_id',
  'handle',
  'display_name',
  'avatar_url',
  'reputation',
  'badges',
  'role',
]

const columns = (alias: string, names: string[]): string =>
  names.map((name) => `${alias}.${name}`).join(', ')

/**
 * `utils/forum-page-data.js` (plan D14b): what the topic, community, Manage
 * and New topic pages render per request, and what the replies and
 * notifications routes answer. Parameterised SQL only, over the forum tables,
 * through the project's own database connection (the one the data API opens:
 * `TELEPORT_DB_*`).
 *
 * Rules, applied here and nowhere else:
 * - a topic or reply is served when `published`, or to a viewer who moderates
 *   it or wrote it (their own pending post);
 * - a private community is read by its active members and moderators only:
 *   to anyone else its topics answer `null` (the page answers `notFound`) and
 *   its own page only the About side (`viewer.can_read` false, no topics);
 * - a community that is not `active` is answered to who moderates it, and one
 *   still `pending` (waiting for approval) to its creator too
 *   (`viewer.is_creator`); its topics are in no public list;
 * - Manage is served to who moderates the community, New topic to a signed-in
 *   viewer who can read it (`loadCommunityGate`): `null` for anyone else;
 * - the reply tree is at most three levels from its root, in `path` order,
 *   the accepted answer first under `best`; a removed reply keeps its place
 *   with its body masked so the thread under it still reads. With flat
 *   replies (`SETTINGS.replyNesting` is `flat`) it is one level: every reply
 *   of the topic in the chosen order, an old reply to a reply among them;
 * - without votes (`SETTINGS.votes` is `off`) there is no score, so no `top`
 *   order of a community's topics;
 * - the viewer block says what the pages gate on: `signed_in`, `my_vote` (by
 *   target id), `my_membership`, `my_role`, `can_moderate`, `can_read`,
 *   `can_post` (anyone signed in where the community is public, an active
 *   member elsewhere; where only moderators post, one who moderates),
 *   `can_reply` (the reply statement's rule: as `can_post`, but only a
 *   `moderators` posting rule keeps members out — an announcements community
 *   takes its members' replies), and on
 *   a topic `is_subscribed`, `is_author`, `can_accept`, `can_edit` (every
 *   reply carries its own `can_edit`): as the edit statement decides it,
 *   never banned nor a removed post, and who moderates it or its author within
 *   `SETTINGS.editWindowMinutes` of writing it (0: always);
 * - the shapes the pages bind are listed in the editor's
 *   `features/forum/constants/forum-shapes.ts`: `tags` as `[{ name }]`,
 *   `attachments` as `[{ url }]`, `body_html`, `community_name`,
 *   `community_url`, `accepted_reply`, `is_mine`, `thread_url`, `rules_text`;
 * - author profiles carry public columns only;
 * - a forum without communities (`SETTINGS.structure` is `topics`) keeps every
 *   topic in one community of its own. It is read for the rights like any
 *   other and never answered: no topic names it or links to it, the composer's
 *   gate answers the viewer alone, and it has no page and no place in the
 *   public index.
 *
 * Every row goes out JSON-plain (dates as ISO strings): Next.js props.
 */
export const buildForumPageDataSource = (
  config: ForumConfig,
  options: { withSessionRevocation?: boolean } = {}
): string => {
  const { settings } = config
  // Where the details pages are served (`forum-markers.ts` there: `/forum/t`, `/forum/c`);
  // a forum without communities has no community page to link to.
  const urls = {
    topic: config.routes.topic?.staticBase || '/forum/t',
    community:
      settings.structure === 'communities' ? config.routes.community?.staticBase || '/forum/c' : '',
  }
  return `'use strict';
// Forum page data — generated by TeleportHQ. Server-side only.
${generateLazyPgClientCode()}
var markdown = require('./${FORUM_MARKDOWN_MODULE_NAME}');

${SessionCookieResolver.generateCommonJsSessionTokenResolverCode('..', {
  withRevocation: options.withSessionRevocation !== false,
})}
// The session cookie's token for a page or route, or null: who is asking.
async function readSession(req) {
  try {
    return (await __tqSessionToken(req)) || null;
  } catch (error) {
    return null;
  }
}

var SETTINGS = ${toJsLiteral(settings)};
// A forum without communities keeps its topics in one community of its own: read for the rights, never answered.
var HAS_COMMUNITIES = SETTINGS.structure !== 'topics';
// Flat replies: one list of every reply, an old reply to a reply among them rather than lost.
var FLAT_REPLIES = SETTINGS.replyNesting === 'flat';
var T =${toJsLiteral(FORUM_TABLES)};
var REPLIES_PAGE = ${FORUM_REPLIES_PAGE};
var TOPICS_PER_PAGE = ${config.communityTopicsPerPage};
var MAX_DEPTH = 3;
var EXCERPT_LENGTH = 240;
var NOTIFICATIONS_PAGE = 30;
var URLS = ${toJsLiteral(urls)};
var STAFF_ROLES = ['admin'];
var TOPIC_SQL = ${toJsLiteral(columns('t', TOPIC_COLUMNS))};
var REPLY_SQL = ${toJsLiteral(columns('r', REPLY_COLUMNS))};
var COMMUNITY_SQL = ${toJsLiteral(columns('c', COMMUNITY_COLUMNS))};
var PROFILE_SQL = ${toJsLiteral(columns('p', PROFILE_COLUMNS))};
var REPLY_SORTS = {
  best: 'r.is_accepted DESC, r.score DESC, r.created_at ASC',
  new: 'r.created_at DESC',
  old: 'r.created_at ASC',
};
var TOPIC_SORTS = {
  latest: 't.last_activity_at DESC NULLS LAST, t.created_at DESC',
  top: 't.score DESC, t.created_at DESC',
  new: 't.created_at DESC',
  unanswered: 't.reply_count ASC, t.created_at DESC',
};

${FORUM_SEO_RUNTIME}
// --- helpers ------------------------------------------------------------------
function text(value) { return value === undefined || value === null ? '' : String(value); }
function num(value) { var n = Number(value); return isFinite(n) ? n : 0; }
function list(value) {
  if (Array.isArray(value)) return value;
  try { var parsed = JSON.parse(text(value) || '[]'); return Array.isArray(parsed) ? parsed : []; } catch (e) { return []; }
}
// A row as JSON-plain values: a Date becomes its ISO string, undefined null.
function plain(row) {
  var out = {};
  Object.keys(row || {}).forEach(function (key) {
    var value = row[key];
    out[key] = value instanceof Date ? value.toISOString() : value === undefined ? null : value;
  });
  return out;
}
function stringList(value) { return list(value).filter(function (item) { return typeof item === 'string' && item !== ''; }); }
// The rules column as the manage form's textarea shows it: one rule per line, "title: text".
function rulesText(rules) {
  return list(rules).map(function (rule) {
    if (!rule || typeof rule !== 'object') return '';
    var title = text(rule.title).trim();
    var body = text(rule.text).trim();
    return title && body ? title + ': ' + body : title || body;
  }).filter(Boolean).join('\\n');
}
function threadUrlOf(topicSlug, replyId) {
  return URLS.topic + '/' + encodeURIComponent(text(topicSlug)) + '?reply=' + encodeURIComponent(text(replyId));
}
function communityUrlOf(communitySlug) {
  return URLS.community + '/' + encodeURIComponent(text(communitySlug));
}
// A topic's community as the pages bind it: its name (the topic's own column, the community's for a topic
// written before the column existed) and where its page is. A forum without communities answers neither, nor its slug.
function nameCommunity(post, community) {
  post.community_name = HAS_COMMUNITIES ? text(post.community_name) || text(community.name) : '';
  post.community_url = HAS_COMMUNITIES ? communityUrlOf(community.slug) : '';
  if (!HAS_COMMUNITIES) post.community_slug = '';
}
function excerptOf(bodyText) {
  var words = text(bodyText).replace(/\\s+/g, ' ').trim();
  return words.length > EXCERPT_LENGTH ? words.slice(0, EXCERPT_LENGTH).replace(/\\s+\\S*$/, '') + '…' : words;
}
function sessionOf(session) {
  var token = session && typeof session === 'object' ? session : null;
  var id = token ? text(token.id || token.sub) : '';
  var role = token ? (typeof token.role === 'string' ? token.role : Array.isArray(token.roles) ? token.roles[0] : null) : null;
  return { id: id, role: role || null };
}
function sortKey(value, sorts, fallback) {
  var key = text(value);
  return Object.prototype.hasOwnProperty.call(sorts, key) ? key : fallback;
}

// One connection per call: opened, used for every read of the call, closed.
async function withClient(work) {
  var client = getClient();
  await client.connect();
  try {
    return await work(function query(sql, params) {
      return client.query(sql, params || []).then(function (result) { return result.rows || []; });
    });
  } finally {
    try { await client.end(); } catch (e) {}
  }
}

// --- the viewer ------------------------------------------------------------------
async function viewerOf(q, user, community) {
  var viewer = {
    signed_in: !!user.id,
    user_id: user.id || null,
    my_membership: null,
    my_role: null,
    can_moderate: false,
    can_delete: false,
    can_read: true,
    can_post: false,
    can_reply: false,
    is_author: false,
    can_accept: false,
    can_edit: false,
    my_vote: 0,
    profile_role: null,
    is_banned: false,
  };
  if (user.id) {
    var profiles = await q('SELECT ' + PROFILE_SQL + ' FROM ' + T.profiles + ' p WHERE p.user_id = $1 LIMIT 1', [user.id]);
    var profile = profiles[0] || null;
    viewer.profile_role = profile ? text(profile.role) || 'member' : null;
    viewer.is_banned = !!profile && profile.role === 'banned';
    var staff = STAFF_ROLES.indexOf(text(user.role)) !== -1 || viewer.profile_role === 'moderator';
    viewer.can_moderate = staff;
    if (community) {
      var memberships = await q(
        'SELECT m.role, m.status FROM ' + T.memberships + ' m WHERE m.community_id = $1 AND m.user_id = $2 LIMIT 1',
        [community.id, user.id]
      );
      var membership = memberships[0] || null;
      viewer.my_membership = membership ? text(membership.status) : null;
      viewer.my_role = membership ? text(membership.role) : null;
      var active = !!membership && membership.status === 'active';
      viewer.can_moderate = staff || (active && (membership.role === 'moderator' || membership.role === 'owner'));
      // Who deletes the whole community, as its statement decides: the owner, a site moderator or an admin.
      viewer.can_delete = HAS_COMMUNITIES && (staff || (active && membership.role === 'owner'));
    }
  }
  if (community) {
    var member = viewer.my_membership === 'active';
    viewer.can_read = community.visibility !== 'private' || member || viewer.can_moderate;
    // Posting, as the statements decide it: anyone signed in where the community
    // is public (unless banned from it), its active members elsewhere; where only
    // moderators post (the community's setting, or an announcements community),
    // the ones who moderate it.
    var moderatorsOnly = community.posting === 'moderators' || community.kind === 'announcements';
    var admitted = member || (viewer.signed_in && community.visibility === 'public' && viewer.my_membership !== 'banned');
    viewer.can_post = admitted && !viewer.is_banned && community.status === 'active' && (!moderatorsOnly || viewer.can_moderate);
    viewer.can_reply = admitted && !viewer.is_banned && community.status === 'active' && (community.posting !== 'moderators' || viewer.can_moderate);
  }
  return viewer;
}

// Whether the viewer may edit this topic or reply, as the edit statement decides it: never banned, never a
// removed post; who moderates it, or its author within SETTINGS.editWindowMinutes of writing it (0: always).
function canEdit(viewer, row) {
  if (!viewer.signed_in || viewer.is_banned || row.status === 'removed') return false;
  if (viewer.can_moderate) return true;
  if (text(row.author_id) !== viewer.user_id) return false;
  return SETTINGS.editWindowMinutes === 0 || new Date(row.created_at).getTime() > Date.now() - SETTINGS.editWindowMinutes * 60000;
}

async function votesOf(q, user, targetIds) {
  var votes = {};
  if (!user.id || !targetIds.length) return votes;
  var rows = await q('SELECT v.target_id, v.value FROM ' + T.votes + ' v WHERE v.user_id = $1 AND v.target_id = ANY($2::uuid[])', [user.id, targetIds]);
  rows.forEach(function (row) { votes[text(row.target_id)] = num(row.value); });
  return votes;
}

// Following is a topic's: joining a community is how it is followed.
async function followsTopic(q, user, topicId) {
  if (!user.id) return false;
  var rows = await q('SELECT 1 FROM ' + T.subscriptions + " s WHERE s.user_id = $1 AND s.target_kind = 'topic' AND s.target_id = $2 LIMIT 1", [user.id, topicId]);
  return rows.length > 0;
}

// { [targetId]: { [emoji]: { count, mine } } } for every target asked.
async function reactionsOf(q, user, targetIds) {
  var byTarget = {};
  targetIds.forEach(function (id) { byTarget[id] = {}; });
  if (!SETTINGS.reactions || !targetIds.length) return byTarget;
  var rows = await q(
    'SELECT x.target_id, x.emoji, COUNT(*)::int AS count, BOOL_OR(x.user_id = $2) AS mine FROM ' + T.reactions +
      ' x WHERE x.target_id = ANY($1::uuid[]) GROUP BY x.target_id, x.emoji',
    [targetIds, user.id || '']
  );
  rows.forEach(function (row) {
    var id = text(row.target_id);
    if (!id || !row.emoji) return;
    if (!byTarget[id]) byTarget[id] = {};
    byTarget[id][text(row.emoji)] = { count: num(row.count), mine: !!row.mine && !!user.id };
  });
  return byTarget;
}

function authorOf(row) {
  return {
    id: text(row.author_id),
    handle: text(row.author_handle),
    name: text(row.author_name),
    avatar: row.author_avatar || null,
    reputation: SETTINGS.reputation ? num(row.author_reputation) : 0,
    badges: SETTINGS.badges ? list(row.author_badges) : [],
    initials: text(row.author_name).split(/\\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase(),
  };
}

// The public shape of a topic or reply: Markdown rendered, JSON columns parsed,
// a removed one masked so the thread keeps its place.
function shapePost(row, votes, reactions) {
  var out = plain(row);
  delete out.author_badges;
  // The page's author line binds author_reputation as a number of its own.
  out.author_reputation = SETTINGS.reputation ? num(row.author_reputation) : 0;
  var removed = row.status === 'removed';
  out.body = removed ? '' : text(row.body);
  out.body_text = removed ? '[removed]' : text(row.body_text);
  out.body_html = removed ? '<p><em>[removed]</em></p>' : markdown.renderForumMarkdown(row.body);
  out.excerpt = excerptOf(out.body_text);
  // The pages bind tags as [{ name }] and attachments as [{ url }] (forum-shapes.ts there);
  // the plain lists stay beside them.
  out.tag_list = stringList(row.tags);
  out.tags = out.tag_list.map(function (name) { return { name: name }; });
  out.attachment_list = removed ? [] : stringList(row.attachments);
  out.attachments = out.attachment_list.map(function (url) { return { url: url }; });
  out.author = authorOf(row);
  out.my_vote = votes[text(row.id)] || 0;
  out.is_mine = false;
  out.reactions = reactions[text(row.id)] || {};
  // The same derived fields the feed transform gives a card (forum-feed.ts).
  out.is_solved = !!row.accepted_reply_id;
  out.is_answered = num(row.reply_count) > 0;
  out.author_initials = out.author.initials;
  return out;
}

function shapeCommunity(row) {
  var out = plain(row);
  out.rule_list = list(row.rules).filter(function (rule) { return rule && typeof rule === 'object'; });
  out.rules_text = rulesText(row.rules);
  out.excerpt = excerptOf(row.description);
  out.is_private = row.visibility === 'private';
  out.initials = text(row.name).split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase();
  return out;
}

// --- replies -----------------------------------------------------------------------
function postVisibility(alias, viewer, user, params) {
  // Published and removed rows for everyone (a removed one is masked); pending
  // ones for a moderator, and to their own author.
  if (viewer.can_moderate) return "(" + alias + ".status IN ('published', 'removed', 'pending'))";
  if (user.id) {
    params.push(user.id);
    return "(" + alias + ".status IN ('published', 'removed') OR (" + alias + ".status = 'pending' AND " + alias + ".author_id = $" + params.length + '))';
  }
  return "(" + alias + ".status IN ('published', 'removed'))";
}

// A community's list: published topics, plus the pending ones a moderator
// reviews and a member's own; removed topics are gone from every list.
function topicVisibility(viewer, user, params) {
  if (viewer.can_moderate) return "(t.status IN ('published', 'pending'))";
  if (user.id) {
    params.push(user.id);
    return "(t.status = 'published' OR (t.status = 'pending' AND t.author_id = $" + params.length + '))';
  }
  return "(t.status = 'published')";
}

function nest(rows, rootDepth, sort) {
  var byId = {};
  var roots = [];
  rows.forEach(function (row) { row.children = []; byId[row.id] = row; });
  rows.forEach(function (row) {
    var parent = row.depth > rootDepth && row.parent_id ? byId[text(row.parent_id)] : null;
    if (parent) parent.children.push(row); else roots.push(row);
  });
  var compare = sort === 'new'
    ? function (a, b) { return text(b.created_at).localeCompare(text(a.created_at)); }
    : sort === 'old'
    ? function (a, b) { return text(a.created_at).localeCompare(text(b.created_at)); }
    : function (a, b) { return (b.is_accepted ? 1 : 0) - (a.is_accepted ? 1 : 0) || num(b.score) - num(a.score) || text(a.created_at).localeCompare(text(b.created_at)); };
  var sortTree = function (nodes) { nodes.sort(compare); nodes.forEach(function (node) { sortTree(node.children); }); };
  sortTree(roots);
  return roots;
}

// The tree under a topic (or under one reply, "Continue this thread"): the
// first REPLIES_PAGE roots after the offset and what is under them. MAX_DEPTH
// levels are drawn, the roots being the first; one level more is read, only so
// a reply of the last drawn level can say its thread goes on. Flat replies are
// one level: the first REPLIES_PAGE of every reply, whatever it answers (a
// "Continue this thread" link reads the same list).
async function replyTree(q, user, viewer, topic, rootReplyId, sort, offset) {
  var rootDepth = -1;
  var params = [topic.id];
  var where = 'r.topic_id = $1';
  if (rootReplyId && !FLAT_REPLIES) {
    var roots = await q('SELECT r.id, r.depth, r.path FROM ' + T.replies + ' r WHERE r.topic_id = $1 AND r.id = $2 LIMIT 1', [topic.id, rootReplyId]);
    if (!roots.length) return { replies: [], hasMore: false, nextOffset: 0 };
    rootDepth = num(roots[0].depth);
    params.push(roots[0].id);
    where += ' AND r.parent_id = $2';
  } else if (!FLAT_REPLIES) {
    where += ' AND r.parent_id IS NULL';
  }
  where += ' AND ' + postVisibility('r', viewer, user, params);
  params.push(REPLIES_PAGE + 1, Math.max(0, num(offset)));
  var heads = await q(
    'SELECT ' + REPLY_SQL + ', p.reputation AS author_reputation, p.badges AS author_badges FROM ' + T.replies + ' r LEFT JOIN ' + T.profiles +
      ' p ON p.user_id = r.author_id WHERE ' + where + ' ORDER BY ' + REPLY_SORTS[sort] + ' LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length,
    params
  );
  var hasMore = heads.length > REPLIES_PAGE;
  heads = heads.slice(0, REPLIES_PAGE);
  var rows = heads;
  if (heads.length && !FLAT_REPLIES) {
    var patterns = heads.map(function (head) { return text(head.path) + '%'; });
    var childParams = [topic.id, patterns, rootDepth + MAX_DEPTH + 1, heads.map(function (head) { return head.id; })];
    var children = await q(
      'SELECT ' + REPLY_SQL + ', p.reputation AS author_reputation, p.badges AS author_badges FROM ' + T.replies + ' r LEFT JOIN ' + T.profiles +
        ' p ON p.user_id = r.author_id WHERE r.topic_id = $1 AND r.path LIKE ANY($2::text[]) AND r.depth <= $3 AND NOT (r.id = ANY($4::uuid[])) AND ' +
        postVisibility('r', viewer, user, childParams) + ' ORDER BY r.path',
      childParams
    );
    rows = heads.concat(children);
  }
  var ids = rows.map(function (row) { return row.id; });
  var votes = await votesOf(q, user, ids);
  var reactions = await reactionsOf(q, user, ids);
  var shaped = rows.map(function (row) { return shapeReply(row, user, viewer, topic, votes, reactions); });
  // A flat list is in the database's order already, and nests nothing.
  return { replies: FLAT_REPLIES ? shaped : nest(shaped, rootDepth, sort), hasMore: hasMore, nextOffset: num(offset) + heads.length };
}

// One reply as the Reply component binds it: the viewer's own, whether they may edit it, and where its thread continues.
function shapeReply(row, user, viewer, topic, votes, reactions) {
  var post = shapePost(row, votes, reactions);
  post.is_author = !!user.id && text(row.author_id) === user.id;
  post.is_mine = post.is_author;
  post.can_edit = canEdit(viewer, row);
  post.thread_url = threadUrlOf(topic.slug, row.id);
  if (!Array.isArray(post.children)) post.children = [];
  return post;
}

// The accepted answer as a reply row (the "Accepted answer" block), from the
// tree when it is on this page, else read by id; null when there is none.
async function acceptedReplyOf(q, user, viewer, topic, replies) {
  var acceptedId = text(topic.accepted_reply_id);
  if (!acceptedId) return null;
  var inTree = flatten(replies).filter(function (reply) { return text(reply.id) === acceptedId; })[0];
  if (inTree) return inTree;
  var params = [topic.id, acceptedId];
  var rows = await q(
    'SELECT ' + REPLY_SQL + ', p.reputation AS author_reputation, p.badges AS author_badges FROM ' + T.replies + ' r LEFT JOIN ' + T.profiles +
      ' p ON p.user_id = r.author_id WHERE r.topic_id = $1 AND r.id = $2 AND ' + postVisibility('r', viewer, user, params) + ' LIMIT 1',
    params
  );
  if (!rows.length) return null;
  var votes = await votesOf(q, user, [rows[0].id]);
  var reactions = await reactionsOf(q, user, [rows[0].id]);
  var reply = shapeReply(rows[0], user, viewer, topic, votes, reactions);
  reply.children = [];
  return reply;
}

async function readableTopic(q, user, slugOrId, byId) {
  var topics = await q(
    'SELECT ' + TOPIC_SQL + ', p.reputation AS author_reputation, p.badges AS author_badges FROM ' + T.topics + ' t LEFT JOIN ' + T.profiles +
      ' p ON p.user_id = t.author_id WHERE t.' + (byId ? 'id' : 'slug') + ' = $1 LIMIT 1',
    [slugOrId]
  );
  var topic = topics[0];
  if (!topic) return null;
  var communities = await q('SELECT ' + COMMUNITY_SQL + ' FROM ' + T.communities + ' c WHERE c.id = $1 LIMIT 1', [topic.community_id]);
  var community = communities[0];
  if (!community) return null;
  var viewer = await viewerOf(q, user, community);
  viewer.is_author = !!user.id && text(topic.author_id) === user.id;
  viewer.can_accept = (viewer.is_author || viewer.can_moderate) && SETTINGS.acceptedAnswers !== 'off' &&
    (SETTINGS.acceptedAnswers === 'all' || community.kind === 'questions');
  viewer.can_edit = canEdit(viewer, topic);
  if (!viewer.can_read) return null;
  if (topic.status !== 'published' && !(viewer.can_moderate || viewer.is_author)) return null;
  if (community.status !== 'active' && !viewer.can_moderate) return null;
  return { topic: topic, community: community, viewer: viewer };
}

// --- the pages ---------------------------------------------------------------------
// { topic, community, viewer, replies, reactions, score, myVote, hasMoreReplies,
//   replySort, replyTo, nextReplyOffset, seo } — or null: the page answers notFound.
async function loadTopicPage(args) {
  var user = sessionOf(args.session);
  var sort = sortKey(args.sort, REPLY_SORTS, 'best');
  return withClient(async function (q) {
    var found = await readableTopic(q, user, text(args.slug), false);
    if (!found) return null;
    var topic = found.topic;
    var viewer = found.viewer;
    var tree = await replyTree(q, user, viewer, topic, text(args.rootReplyId) || null, sort, 0);
    var votes = await votesOf(q, user, [topic.id]);
    var reactions = await reactionsOf(q, user, [topic.id]);
    // The viewer's vote on the topic itself: a number (the replies carry their own).
    viewer.my_vote = votes[text(topic.id)] || 0;
    viewer.is_subscribed = await followsTopic(q, user, topic.id);
    var post = shapePost(topic, votes, reactions);
    post.is_author = viewer.is_author;
    post.is_mine = viewer.is_author;
    nameCommunity(post, found.community);
    post.accepted_reply = await acceptedReplyOf(q, user, viewer, topic, tree.replies);
    var community = shapeCommunity(found.community);
    var url = text(args.url);
    return {
      topic: post,
      community: HAS_COMMUNITIES ? community : null,
      viewer: viewer,
      replies: tree.replies,
      reactions: post.reactions,
      score: num(topic.score),
      myVote: post.my_vote,
      hasMoreReplies: tree.hasMore,
      nextReplyOffset: tree.nextOffset,
      replySort: sort,
      replyTo: text(args.rootReplyId) || '',
      seo: {
        noindex: topicNoIndex(topic, found.community),
        jsonLd: url && !topicNoIndex(topic, found.community) ? topicJsonLd(post, community, flatten(tree.replies), url) : null,
      },
    };
  });
}

function flatten(nodes) {
  var out = [];
  (nodes || []).forEach(function (node) { out.push(node); out = out.concat(flatten(node.children)); });
  return out;
}

// { community, viewer, topics, sortBy, paging, rules, moderators, pendingJoinCount,
//   openReportCount, seo } — or null. topics is one page of the list, in the order
// sortBy names; paging says where it stands: { page, pages, previous, next }, the
// last two the page numbers the pager's links open, 0 where there is none.
// A private community's non-member gets the About side only: can_read false, no topics.
async function loadCommunityPage(args) {
  if (!HAS_COMMUNITIES) return null; // a forum without communities has no such page
  var user = sessionOf(args.session);
  var sort = sortKey(args.sort, TOPIC_SORTS, 'latest');
  // Without votes there is no score to order by.
  if (sort === 'top' && SETTINGS.votes === 'off') sort = 'latest';
  var page = Math.max(1, num(args.page) || 1);
  return withClient(async function (q) {
    var communities = await q('SELECT ' + COMMUNITY_SQL + ' FROM ' + T.communities + ' c WHERE c.slug = $1 LIMIT 1', [text(args.slug)]);
    var row = communities[0];
    if (!row) return null;
    var viewer = await viewerOf(q, user, row);
    // A community waiting for approval is its creator's to see (the page tells them so) and its
    // moderators'; an archived one its moderators' only.
    viewer.is_creator = !!user.id && text(row.created_by) === user.id;
    if (row.status !== 'active' && !viewer.can_moderate && !(row.status === 'pending' && viewer.is_creator)) return null;
    var community = shapeCommunity(row);
    // Who runs it, the owner first. The role is the membership's, never the profile's.
    var moderators = await q(
      'SELECT m.user_id, m.role, p.handle, p.display_name, p.avatar_url FROM ' + T.memberships + ' m LEFT JOIN ' + T.profiles +
        " p ON p.user_id = m.user_id WHERE m.community_id = $1 AND m.status = 'active' AND m.role IN ('owner', 'moderator') AND COALESCE(p.role, '') <> 'banned' ORDER BY (m.role = 'owner') DESC, m.joined_at LIMIT 20",
      [row.id]
    );
    var result = {
      community: community,
      viewer: viewer,
      topics: [],
      sortBy: sort,
      paging: { page: 1, pages: 1, previous: 0, next: 0 },
      rules: community.rule_list.map(function (rule) { return { title: text(rule.title), text: text(rule.text) }; }),
      moderators: moderators.map(function (m) {
        return { user_id: text(m.user_id), handle: text(m.handle), name: text(m.display_name) || text(m.handle) || 'Member', avatar: m.avatar_url || null, role: text(m.role) };
      }),
      pendingJoinCount: 0,
      openReportCount: 0,
      seo: { noindex: row.status !== 'active' || row.visibility === 'private' },
    };
    if (!viewer.can_read) return result;
    var params = [row.id];
    var where = 't.community_id = $1 AND ' + topicVisibility(viewer, user, params);
    var counted = await q('SELECT COUNT(*)::int AS total FROM ' + T.topics + ' t WHERE ' + where, params);
    var pages = Math.max(1, Math.ceil(num(counted[0] && counted[0].total) / TOPICS_PER_PAGE));
    // A page past the last one (an old link, topics removed since) is the last one.
    page = Math.min(page, pages);
    result.paging = { page: page, pages: pages, previous: page > 1 ? page - 1 : 0, next: page < pages ? page + 1 : 0 };
    params.push(TOPICS_PER_PAGE, (page - 1) * TOPICS_PER_PAGE);
    var topics = await q(
      'SELECT ' + TOPIC_SQL + ', p.reputation AS author_reputation, p.badges AS author_badges FROM ' + T.topics + ' t LEFT JOIN ' + T.profiles +
        ' p ON p.user_id = t.author_id WHERE ' + where + ' ORDER BY t.is_pinned DESC, ' + TOPIC_SORTS[sort] + ' LIMIT $' + (params.length - 1) + ' OFFSET $' + params.length,
      params
    );
    var votes = await votesOf(q, user, topics.map(function (t) { return t.id; }));
    result.topics = topics.map(function (t) {
      var post = shapePost(t, votes, {});
      post.body = '';
      post.body_html = '';
      post.is_mine = !!user.id && text(t.author_id) === user.id;
      nameCommunity(post, row);
      return post;
    });
    if (viewer.can_moderate) {
      var joins = await q('SELECT COUNT(*)::int AS total FROM ' + T.memberships + " m WHERE m.community_id = $1 AND m.status = 'pending'", [row.id]);
      var reports = await q('SELECT COUNT(*)::int AS total FROM ' + T.reports + " x WHERE x.community_id = $1 AND x.status = 'open'", [row.id]);
      result.pendingJoinCount = num(joins[0] && joins[0].total);
      result.openReportCount = num(reports[0] && reports[0].total);
    }
    return result;
  });
}

// A community's Manage (need 'moderate') and New topic (need 'post') pages:
// { community, viewer } — or null (notFound). The row is read whatever its
// visibility; the viewer decides: Manage for who moderates it, New topic for a
// signed-in viewer who can read it (one who may not post yet is told to join there).
async function loadCommunityGate(args) {
  var user = sessionOf(args.session);
  if (!user.id) return null;
  return withClient(async function (q) {
    var communities = await q('SELECT ' + COMMUNITY_SQL + ' FROM ' + T.communities + ' c WHERE c.slug = $1 LIMIT 1', [text(args.slug)]);
    var row = communities[0];
    if (!row) return null;
    var viewer = await viewerOf(q, user, row);
    var admitted = args.need === 'moderate' ? viewer.can_moderate : args.need === 'post' && (viewer.can_post || viewer.can_read);
    if (!admitted || (row.status !== 'active' && !viewer.can_moderate)) return null;
    if (!HAS_COMMUNITIES) return { community: null, viewer: viewer }; // its composer is answered the rights alone
    // What the Manage page's own load answers beside the rights (forum-shapes.ts there).
    viewer.community_id = text(row.id);
    viewer.community_slug = text(row.slug);
    viewer.community_name = text(row.name);
    return { community: shapeCommunity(row), viewer: viewer };
  });
}

// { replies, hasMore, nextOffset, replyCount } for the replies route — or null
// when the topic cannot be read by this viewer. replyCount is the topic's
// published replies as stored now: the page's count follows a reply posted.
async function loadReplies(args) {
  var user = sessionOf(args.session);
  var sort = sortKey(args.sort, REPLY_SORTS, 'best');
  return withClient(async function (q) {
    var found = await readableTopic(q, user, text(args.topicId), true);
    if (!found) return null;
    var tree = await replyTree(q, user, found.viewer, found.topic, text(args.rootReplyId) || null, sort, num(args.after));
    tree.replyCount = num(found.topic.reply_count);
    return tree;
  });
}

// --- notifications ---------------------------------------------------------------------
async function loadNotifications(session, args) {
  var user = sessionOf(session);
  if (!user.id) return { items: [], unreadCount: 0 };
  var limit = Math.min(100, Math.max(1, num(args && args.limit) || NOTIFICATIONS_PAGE));
  return withClient(async function (q) {
    var rows = await q(
      'SELECT n.id, n.kind, n.title, n.body, n.url, n.actor_handle, n.read_at, n.created_at FROM ' + T.notifications +
        ' n WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT $2',
      [user.id, limit]
    );
    var unread = await q('SELECT COUNT(*)::int AS total FROM ' + T.notifications + ' n WHERE n.user_id = $1 AND n.read_at IS NULL', [user.id]);
    // text is what the profile tab's row binds; the overlay binds title and body.
    return {
      items: rows.map(function (row) { var out = plain(row); out.text = text(row.title); return out; }),
      unreadCount: num(unread[0] && unread[0].total),
    };
  });
}

async function markNotificationsRead(session, ids) {
  var user = sessionOf(session);
  if (!user.id) return 0;
  var only = Array.isArray(ids) ? ids.map(text).filter(Boolean).slice(0, 200) : null;
  return withClient(async function (q) {
    var rows = await q(
      'UPDATE ' + T.notifications + ' SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL' + (only ? ' AND id = ANY($2::uuid[])' : '') + ' RETURNING id',
      only ? [user.id, only] : [user.id]
    );
    return rows.length;
  });
}

// Of these storage file ids, the ones a topic, a reply or a community's icon or banner
// still shows: they hold the file's address, \`<bucket>/<project>/<file id>/<name>\`.
async function filesStillShown(fileIds) {
  return withClient(async function (q) {
    var rows = await q(
      'SELECT f.id FROM unnest($1::text[]) AS f(id) WHERE EXISTS (SELECT 1 FROM ' + T.topics + " t WHERE t.attachments::text LIKE '%/' || f.id || '/%') OR EXISTS (SELECT 1 FROM " + T.replies + " r WHERE r.attachments::text LIKE '%/' || f.id || '/%') OR EXISTS (SELECT 1 FROM " + T.communities + " c WHERE COALESCE(c.icon_url, '') LIKE '%/' || f.id || '/%' OR COALESCE(c.banner_url, '') LIKE '%/' || f.id || '/%')",
      [fileIds]
    );
    return rows.map(function (row) { return text(row.id); });
  });
}

// --- the live index ------------------------------------------------------------------------
async function listPublicIndex() {
  return withClient(async function (q) {
    var communities = HAS_COMMUNITIES ? await q(
      'SELECT c.slug, c.name, c.description, c.updated_at FROM ' + T.communities + " c WHERE c.status = 'active' AND c.visibility <> 'private' ORDER BY c.sort_order, c.created_at LIMIT 5000"
    ) : [];
    var topics = await q(
      // A topic of an archived community, or of one still waiting for approval, is not public.
      'SELECT t.slug, t.title, t.body_text, t.updated_at FROM ' + T.topics + " t WHERE t.status = 'published' AND t.community_visibility <> 'private' AND EXISTS (SELECT 1 FROM " +
        T.communities + " c WHERE c.id = t.community_id AND c.status = 'active') ORDER BY t.created_at DESC LIMIT 50000"
    );
    return {
      communities: communities.map(plain),
      topics: topics.map(function (t) { var out = plain(t); out.excerpt = excerptOf(t.body_text); delete out.body_text; return out; }),
    };
  });
}

module.exports = {
  readSession: readSession,
  loadTopicPage: loadTopicPage,
  loadCommunityPage: loadCommunityPage,
  loadCommunityGate: loadCommunityGate,
  loadReplies: loadReplies,
  loadNotifications: loadNotifications,
  markNotificationsRead: markNotificationsRead,
  filesStillShown: filesStillShown,
  listPublicIndex: listPublicIndex,
  settings: SETTINGS,
};
`
}
