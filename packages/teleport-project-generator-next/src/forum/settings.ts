import { ProjectUIDL, UIDLPluginSettingValue } from '@teleporthq/teleport-types'
import { ContentTables } from '@teleporthq/teleport-shared'
import { DetailsRoute, resolveTableDataSource } from '../instant-search/sections'

/**
 * The Forum plugin's settings as the editor stores them
 * (`features/plugins/registry/definitions/forum.ts` there), its pages' routes
 * (`uidl.plugins.forum.pages`, by page type) and the data source its tables
 * live in. Every value is checked: the published site bakes them into the
 * forum data module and its routes.
 */

export const FORUM_PLUGIN_KEY = 'forum'
export const FORUM_TABLES = ContentTables.FORUM_TABLES

/**
 * How the forum is organised: in communities members join, or as one list of
 * topics. A topic is always stored in a community, so a forum without
 * communities keeps every topic in one of its own — the main community —
 * which the published site reads for the rights and never shows.
 */
export type ForumStructure = 'communities' | 'topics'

/**
 * The slug of the main community. MUST stay in step with
 * `FORUM_MAIN_COMMUNITY_SLUG` in the editor's
 * `apps/gui/app/project-page/features/forum/constants/forum-structure.ts`.
 */
export const FORUM_MAIN_COMMUNITY_SLUG = 'main'

export interface ForumSettings {
  structure: ForumStructure
  membersCreateCommunities: boolean
  communityApproval: 'none' | 'owner'
  maxCommunitiesPerMember: number
  defaultVisibility: 'public' | 'restricted' | 'private'
  attachments: boolean
  maxAttachments: number
  tags: boolean
  editWindowMinutes: number
  replyNesting: 'nested' | 'flat'
  topicsPerDay: number
  votes: 'updown' | 'up' | 'off'
  reactions: boolean
  acceptedAnswers: 'questions' | 'all' | 'off'
  reputation: boolean
  badges: boolean
  moderation: 'none' | 'newMembers' | 'all'
  newMemberPosts: number
  holdLinks: boolean
  notifications: boolean
  emailOnReply: boolean
}

/** A page of a community's topic list: what a project that never set it gets, and the most it may hold. */
export const FORUM_COMMUNITY_TOPICS_PER_PAGE = 20
export const FORUM_COMMUNITY_TOPICS_PER_PAGE_MAX = 50

/** The page types the editor's plugin record names (`forum-markers.ts` there). */
export type ForumPageType = 'home' | 'communities' | 'community' | 'topic' | 'new-topic' | 'manage'

/**
 * The pages served per record. Three of them are pages of a community: its
 * own, Manage and New topic. A forum without communities has the topic page
 * and New topic only, the latter a static page (`ForumConfig.composerPath`).
 */
export type ForumDetailsPage = 'topic' | 'community' | 'manage' | 'newTopic'

export interface ForumConfig {
  settings: ForumSettings
  /**
   * The route of each page a forum of this structure has, as the editor
   * resolved it; a details page is `<base>` (`/forum/t`), without its `[slug]`.
   */
  pages: Partial<Record<ForumPageType, string>>
  /** Where each details page is served: `<staticBase>/[column]`. */
  routes: Record<ForumDetailsPage, DetailsRoute | null>
  /**
   * The New topic page of a forum without communities: a static page
   * (`/forum/new`) that always writes in the main community. Null in a forum
   * with communities, where it is a community's details page (`routes.newTopic`).
   */
  composerPath: string | null
  /** How many topics a page of a community's list holds (the community page's own setting in the editor). */
  communityTopicsPerPage: number
  /** The data source the forum tables are read through (the project's TeleportHQ one). */
  dataSource: { dataSourceId: string; dataSourceType: string } | null
}

export const FORUM_DEFAULTS: ForumSettings = {
  structure: 'communities',
  membersCreateCommunities: true,
  communityApproval: 'none',
  maxCommunitiesPerMember: 3,
  defaultVisibility: 'public',
  attachments: true,
  maxAttachments: 4,
  tags: true,
  editWindowMinutes: 30,
  replyNesting: 'nested',
  topicsPerDay: 20,
  votes: 'updown',
  reactions: false,
  acceptedAnswers: 'questions',
  reputation: true,
  badges: true,
  // Every post shows at once unless the owner chose approval (the editor's registry default).
  moderation: 'none',
  newMemberPosts: 3,
  holdLinks: false,
  notifications: true,
  emailOnReply: false,
}

/** The pages a forum of each structure is built with (`forumPageTypes` in the editor's `forum-structure.ts`). */
const PAGE_TYPES: Record<ForumStructure, ForumPageType[]> = {
  communities: ['home', 'communities', 'community', 'topic', 'new-topic', 'manage'],
  topics: ['home', 'topic', 'new-topic'],
}

type Stored = Record<string, UIDLPluginSettingValue | undefined>

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const integer = (value: unknown, fallback: number, min: number, max: number): number => {
  const rounded = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, rounded))
}

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback

/** `/forum/t/[slug]` and `/forum/t` both name the base `/forum/t`. */
const routeBase = (route: unknown): string | null => {
  if (typeof route !== 'string' || !route.startsWith('/')) {
    return null
  }
  const base = route.replace(/\/\[[^\]]*\]$/, '').replace(/\/+$/, '')
  return base || '/'
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Where a details page is served, from ITS recorded base. The table cannot
 * name the page: the community, Manage and New topic pages all bind the
 * communities table. The project's routes only say which column the address
 * ends with.
 */
const detailsRoute = (uidl: ProjectUIDL, base: string | undefined): DetailsRoute | null => {
  if (!base) {
    return null
  }
  const staticBase = base === '/' ? '' : base
  const values = (
    uidl as unknown as { root?: { stateDefinitions?: { route?: { values?: unknown[] } } } }
  ).root?.stateDefinitions?.route?.values
  for (const value of Array.isArray(values) ? values : []) {
    const pageOptions = (value as { pageOptions?: Record<string, unknown> })?.pageOptions
    const navLink = String(pageOptions?.navLink || '')
    if (!/\/\[[^\]]*\]$/.test(navLink) || routeBase(navLink) !== base) {
      continue
    }
    const info = pageOptions?.detailsPageInfo as { differentiatorColumn?: unknown } | undefined
    const column = info?.differentiatorColumn || pageOptions?.dynamicRouteAttribute
    if (typeof column === 'string' && IDENTIFIER.test(column)) {
      return { staticBase, column }
    }
  }
  return { staticBase, column: 'slug' }
}

/** The plugin's configuration when the project has it on; null otherwise. */
export const resolveForumConfig = (uidl: ProjectUIDL): ForumConfig | null => {
  const record = uidl.plugins?.[FORUM_PLUGIN_KEY]
  if (
    !record ||
    typeof record !== 'object' ||
    !record.settings ||
    typeof record.settings !== 'object'
  ) {
    return null
  }
  const stored = record.settings as Stored
  const settings: ForumSettings = {
    structure: oneOf(stored.structure, ['communities', 'topics'], FORUM_DEFAULTS.structure),
    membersCreateCommunities: bool(
      stored.membersCreateCommunities,
      FORUM_DEFAULTS.membersCreateCommunities
    ),
    communityApproval: oneOf(
      stored.communityApproval,
      ['none', 'owner'],
      FORUM_DEFAULTS.communityApproval
    ),
    maxCommunitiesPerMember: integer(
      stored.maxCommunitiesPerMember,
      FORUM_DEFAULTS.maxCommunitiesPerMember,
      1,
      20
    ),
    defaultVisibility: oneOf(
      stored.defaultVisibility,
      ['public', 'restricted', 'private'],
      FORUM_DEFAULTS.defaultVisibility
    ),
    attachments: bool(stored.attachments, FORUM_DEFAULTS.attachments),
    maxAttachments: integer(stored.maxAttachments, FORUM_DEFAULTS.maxAttachments, 1, 10),
    tags: bool(stored.tags, FORUM_DEFAULTS.tags),
    editWindowMinutes: integer(stored.editWindowMinutes, FORUM_DEFAULTS.editWindowMinutes, 0, 1440),
    replyNesting: oneOf(stored.replyNesting, ['nested', 'flat'], FORUM_DEFAULTS.replyNesting),
    topicsPerDay: integer(stored.topicsPerDay, FORUM_DEFAULTS.topicsPerDay, 1, 200),
    votes: oneOf(stored.votes, ['updown', 'up', 'off'], FORUM_DEFAULTS.votes),
    reactions: bool(stored.reactions, FORUM_DEFAULTS.reactions),
    acceptedAnswers: oneOf(
      stored.acceptedAnswers,
      ['questions', 'all', 'off'],
      FORUM_DEFAULTS.acceptedAnswers
    ),
    reputation: bool(stored.reputation, FORUM_DEFAULTS.reputation),
    badges: bool(stored.badges, FORUM_DEFAULTS.badges),
    moderation: oneOf(stored.moderation, ['none', 'newMembers', 'all'], FORUM_DEFAULTS.moderation),
    newMemberPosts: integer(stored.newMemberPosts, FORUM_DEFAULTS.newMemberPosts, 1, 20),
    holdLinks: bool(stored.holdLinks, FORUM_DEFAULTS.holdLinks),
    notifications: bool(stored.notifications, FORUM_DEFAULTS.notifications),
    emailOnReply: bool(stored.emailOnReply, FORUM_DEFAULTS.emailOnReply),
  }

  const pages: Partial<Record<ForumPageType, string>> = {}
  const recorded = record.pages && typeof record.pages === 'object' ? record.pages : {}
  for (const type of PAGE_TYPES[settings.structure]) {
    const base = routeBase(recorded[type])
    if (base) {
      pages[type] = base
    }
  }
  const composer = pages['new-topic']
  const hasCommunities = settings.structure === 'communities'

  return {
    settings,
    pages,
    routes: {
      topic: detailsRoute(uidl, pages.topic),
      community: detailsRoute(uidl, pages.community),
      manage: detailsRoute(uidl, pages.manage),
      newTopic: hasCommunities ? detailsRoute(uidl, composer) : null,
    },
    composerPath: hasCommunities ? null : composer ?? null,
    communityTopicsPerPage: integer(
      record.data?.communityTopicsPerPage,
      FORUM_COMMUNITY_TOPICS_PER_PAGE,
      1,
      FORUM_COMMUNITY_TOPICS_PER_PAGE_MAX
    ),
    dataSource: resolveTableDataSource(uidl, FORUM_TABLES.topics),
  }
}
