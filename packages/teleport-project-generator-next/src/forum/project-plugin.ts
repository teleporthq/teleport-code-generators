import {
  FileType,
  GeneratedFile,
  InMemoryFileRecord,
  ProjectPlugin,
  ProjectPluginStructure,
  ProjectUIDL,
} from '@teleporthq/teleport-types'
import { PageArrival } from '@teleporthq/teleport-shared'
import {
  ensureSecurityRuntimeModule,
  getDatabaseDriverDependencies,
} from '@teleporthq/teleport-plugin-next-workflows'
import { DetailsRoute } from '../instant-search/sections'
import { resolveAppLocales } from '../pwa/locales'
import {
  ForumConfig,
  ForumDetailsPage,
  FORUM_MAIN_COMMUNITY_SLUG,
  resolveForumConfig,
} from './settings'
import {
  buildForumMarkdownSource,
  FORUM_MARKDOWN_MODULE_NAME,
  FORUM_MARKDOWN_MODULE_PATH,
} from './markdown-source'
import {
  buildForumPageDataSource,
  FORUM_PAGE_DATA_MODULE_NAME,
  FORUM_PAGE_DATA_MODULE_PATH,
} from './page-data-source'
import { buildForumRepliesRouteSource, FORUM_REPLIES_ROUTE } from './replies-route'
import { buildForumFilesRouteSource, FORUM_FILES_ROUTE } from './files-route'
import {
  buildForumNotificationsRouteSource,
  FORUM_NOTIFICATIONS_ROUTE,
} from './notifications-route'
import {
  buildForumLlmsPageSource,
  buildForumSitemapPageSource,
  FORUM_LLMS_PATH,
  FORUM_SITEMAP_PATH,
} from './seo'
import { ForumPageRecord, rewriteForumPage } from './page-rewrite'

export const FORUM_FILE_KEYS = {
  markdown: 'forum-markdown',
  pageData: 'forum-page-data',
  repliesRoute: 'forum-replies-route',
  filesRoute: 'forum-files-route',
  notificationsRoute: 'forum-notifications-route',
  sitemap: 'forum-sitemap',
  llms: 'forum-llms',
  pageArrival: `resource-${PageArrival.PAGE_ARRIVAL_DIR.join('/')}/${
    PageArrival.PAGE_ARRIVAL_FILE_NAME
  }`,
}

/** `/api/plugins/forum/replies` → `pages/api/plugins/forum` + `replies`. */
const routeFile = (route: string): { path: string[]; name: string } => {
  const segments = route.split('/').filter(Boolean)
  return { path: ['pages', ...segments.slice(0, -1)], name: segments[segments.length - 1] }
}

const setJsFile = (
  structure: ProjectPluginStructure,
  key: string,
  path: string[],
  name: string,
  content: string
): void => {
  structure.files.set(key, { path, files: [{ name, fileType: FileType.JS, content }] })
}

const hasFile = (files: Map<string, InMemoryFileRecord>, path: string[], name: string): boolean => {
  let found = false
  files.forEach((record) => {
    if (!found && record?.path?.join('/') === path.join('/')) {
      found = (record.files || []).some((file: GeneratedFile) => file?.name === name)
    }
  })
  return found
}

/** Where a generated page is written: `<folder>/<name>.js`. */
interface PageFileAddress {
  folder: string[]
  name: string
}

const segmentsOf = (route: string): string[] => route.split('/').filter(Boolean)

/** A details page is written under its column: `/forum/t/[slug]` at `pages/forum/t/[slug].js`. */
const detailsPageFile = (route: DetailsRoute): PageFileAddress => ({
  folder: ['pages', ...segmentsOf(route.staticBase)],
  name: `[${route.column}]`,
})

/** A static page is written under its last segment: `/forum/new` at `pages/forum/new.js`. */
const staticPageFile = (route: string): PageFileAddress => {
  const segments = segmentsOf(route)
  const name = segments.pop() ?? 'index'
  return { folder: ['pages', ...segments], name }
}

/** The generated page at `address`, as `files` keeps it. */
const findPageFile = (
  files: Map<string, InMemoryFileRecord>,
  address: PageFileAddress
): { record: InMemoryFileRecord; file: GeneratedFile } | null => {
  const folder = address.folder.join('/')
  const { name } = address
  let found: { record: InMemoryFileRecord; file: GeneratedFile } | null = null
  files.forEach((record) => {
    if (found || record?.path?.join('/') !== folder) {
      return
    }
    const file = (record.files || []).find(
      (candidate: GeneratedFile) =>
        candidate?.name === name &&
        typeof candidate.content === 'string' &&
        candidate.fileType === FileType.JS
    )
    if (file) {
      found = { record, file }
    }
  })
  return found
}

/** What the page reads its row as (`initialPropsData.exposeAs.name`), from the project's routes. */
const exposeAsOf = (uidl: ProjectUIDL, route: DetailsRoute): string | null => {
  const values = (
    uidl as unknown as { root?: { stateDefinitions?: { route?: { values?: unknown[] } } } }
  ).root?.stateDefinitions?.route?.values
  const navLink = `${route.staticBase}/[${route.column}]`
  for (const value of Array.isArray(values) ? values : []) {
    const pageOptions = (value as { pageOptions?: Record<string, unknown> })?.pageOptions
    if (pageOptions?.navLink !== navLink) {
      continue
    }
    const exposeAs = (pageOptions.initialPropsData as { exposeAs?: { name?: string } } | undefined)
      ?.exposeAs
    return typeof exposeAs?.name === 'string' && exposeAs.name ? exposeAs.name : null
  }
  return null
}

/** A page to render per request: where it is written, and which record it is about. */
interface ForumPageTarget {
  kind: ForumDetailsPage
  file: PageFileAddress
  record: ForumPageRecord
  exposeAs: string | null
}

const DETAILS_PAGES: ForumDetailsPage[] = ['topic', 'community', 'manage', 'newTopic']

/**
 * The pages the project has, of the ones served per request: its details
 * pages, each about the record its address names, and — in a forum without
 * communities — the static New topic page, always about the main community
 * (no route column, no record prop).
 */
const forumPageTargets = (uidl: ProjectUIDL, config: ForumConfig): ForumPageTarget[] => {
  const targets: ForumPageTarget[] = []
  for (const kind of DETAILS_PAGES) {
    const route = config.routes[kind]
    if (route) {
      targets.push({
        kind,
        file: detailsPageFile(route),
        record: { column: route.column },
        exposeAs: exposeAsOf(uidl, route),
      })
    }
  }
  if (config.composerPath) {
    targets.push({
      kind: 'newTopic',
      file: staticPageFile(config.composerPath),
      record: { slug: FORUM_MAIN_COMMUNITY_SLUG },
      exposeAs: null,
    })
  }
  return targets
}

/**
 * The Forum plugin on the published site (plan §12): the read side only, since
 * every write is an editor-built workflow. Emits the Markdown renderer and the
 * forum data module, the replies and notifications routes, the forum's own
 * sitemap and llms file, and rewrites the four details pages to render per
 * request through the module (`page-rewrite.ts`): the session decides what is
 * shown. To a non-member, a private community's topic answers `notFound` and
 * its own page shows the About side only (`viewer.can_read` false, no
 * topics). Anonymous answers of the topic and community pages are cached 30 s
 * at the edge, signed-in ones never. A community's Manage and New topic pages
 * are served to who moderates it and to a signed-in viewer who can read it,
 * `notFound` to anyone else, and are never cached nor indexed. A forum without
 * communities (`settings.structure`) has the topic page and a static New topic
 * page, served through the same gate for its main community; no community is
 * named, linked or listed there. A project without the plugin comes out
 * exactly as before.
 */
export class NextForumProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, dependencies } = structure
    const config = resolveForumConfig(uidl)
    if (!config) {
      return structure
    }
    const withSessionRevocation = uidl.authentication?.enabled === true

    setJsFile(
      structure,
      FORUM_FILE_KEYS.markdown,
      FORUM_MARKDOWN_MODULE_PATH,
      FORUM_MARKDOWN_MODULE_NAME,
      buildForumMarkdownSource()
    )
    setJsFile(
      structure,
      FORUM_FILE_KEYS.pageData,
      FORUM_PAGE_DATA_MODULE_PATH,
      FORUM_PAGE_DATA_MODULE_NAME,
      buildForumPageDataSource(config, { withSessionRevocation })
    )
    const replies = routeFile(FORUM_REPLIES_ROUTE)
    setJsFile(
      structure,
      FORUM_FILE_KEYS.repliesRoute,
      replies.path,
      replies.name,
      buildForumRepliesRouteSource({ withSessionRevocation })
    )
    const files = routeFile(FORUM_FILES_ROUTE)
    setJsFile(
      structure,
      FORUM_FILE_KEYS.filesRoute,
      files.path,
      files.name,
      buildForumFilesRouteSource({ withSessionRevocation })
    )
    if (config.settings.notifications) {
      const notifications = routeFile(FORUM_NOTIFICATIONS_ROUTE)
      setJsFile(
        structure,
        FORUM_FILE_KEYS.notificationsRoute,
        notifications.path,
        notifications.name,
        buildForumNotificationsRouteSource({ withSessionRevocation })
      )
    }
    setJsFile(
      structure,
      FORUM_FILE_KEYS.sitemap,
      ['pages'],
      FORUM_SITEMAP_PATH.slice(1),
      buildForumSitemapPageSource(config, {
        multilingual:
          Boolean(uidl.internationalization) && resolveAppLocales(uidl).locales.length > 1,
      })
    )
    setJsFile(
      structure,
      FORUM_FILE_KEYS.llms,
      ['pages'],
      FORUM_LLMS_PATH.slice(1),
      buildForumLlmsPageSource(config)
    )

    // The routes count their visitors through the shared security runtime; the
    // module reads the database through the same driver as the data API.
    ensureSecurityRuntimeModule(structure)
    for (const [name, version] of Object.entries(getDatabaseDriverDependencies('teleport'))) {
      if (!dependencies[name]) {
        dependencies[name] = version
      }
    }

    this.rewritePages(structure, config)
    return structure
  }

  private rewritePages(structure: ProjectPluginStructure, config: ForumConfig): void {
    const { uidl, files } = structure
    let remounts = false
    for (const target of forumPageTargets(uidl, config)) {
      const page = findPageFile(files, target.file)
      if (!page) {
        continue
      }
      const rootPrefix = page.record.path.map(() => '..').join('/') + '/'
      const result = rewriteForumPage(page.file.content as string, {
        ...target.record,
        kind: target.kind,
        exposeAs: target.exposeAs,
        rootPrefix,
        dataModulePath: [...FORUM_PAGE_DATA_MODULE_PATH, FORUM_PAGE_DATA_MODULE_NAME].join('/'),
        pageArrivalPath: [...PageArrival.PAGE_ARRIVAL_DIR, PageArrival.PAGE_ARRIVAL_FILE_NAME].join(
          '/'
        ),
      })
      if (!result) {
        continue
      }
      page.file.content = result.content
      remounts = remounts || result.remounts
    }
    if (
      remounts &&
      !hasFile(files, PageArrival.PAGE_ARRIVAL_DIR, PageArrival.PAGE_ARRIVAL_FILE_NAME)
    ) {
      setJsFile(
        structure,
        FORUM_FILE_KEYS.pageArrival,
        [...PageArrival.PAGE_ARRIVAL_DIR],
        PageArrival.PAGE_ARRIVAL_FILE_NAME,
        PageArrival.generatePageArrivalRuntime()
      )
    }
  }
}
