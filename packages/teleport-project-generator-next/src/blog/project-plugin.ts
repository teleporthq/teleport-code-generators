import {
  FileType,
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLBlogSettings,
} from '@teleporthq/teleport-types'
import { ContentTables } from '@teleporthq/teleport-shared'
import { ensureDataSourceUtilityModule } from '../data-source-utility-plugin'
import { generateBlogContextFileContent } from './blog-context-generator'
import { addBlogRssFeed } from './rss-feed'
import { addContentSiteIndex } from './content-site-index'
import {
  ContentCategoryPagesPreset,
  generateContentCategoryPagesSource,
} from './content-category-pages'

/** The import specifier the generated blog pages resolve `useBlogCategories` from. */
const BLOG_CONTEXT_MODULE = '@/blog-context'

/**
 * Emits the generated `blog-context.js` module — the blog's baked category
 * taxonomy behind `useBlogCategories()` (see `blog-context-generator.ts`) —
 * and, when the blog has one, its RSS feed (see `rss-feed.ts`); the content
 * presets' category pages and their live sitemaps and llms files (see
 * `content-category-pages.ts`, `content-site-index.ts`).
 *
 * Emitted when the project carries `blogSettings`, and ALSO — with an empty
 * taxonomy — whenever any generated file imports the module without it. That
 * second branch mirrors `NextEcommerceProjectPlugin`'s: a component can
 * reference the hook (a blog listing's category filter, a post's breadcrumbs)
 * on a project whose `blogSettings` did not survive, and without the file those
 * imports dangle and `next build` fails with "Module not found: Can't resolve
 * '@/blog-context'". Projects that never reference it are untouched.
 */
export class NextBlogProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files } = structure
    const blogSettings = uidl.blogSettings
    const helpCenterSettings = uidl.helpCenterSettings

    if (!blogSettings && !helpCenterSettings && !projectReferencesBlogContext(files)) {
      return structure
    }

    files.set('blog-context', {
      path: [],
      files: [
        {
          name: 'blog-context',
          fileType: FileType.JS,
          content: generateBlogContextFileContent(blogSettings, helpCenterSettings),
        },
      ],
    })

    if (blogSettings?.rssFeed) {
      addBlogRssFeed(structure, blogSettings.rssFeed)
    }

    addContentCategoryPages(structure, [
      ['blog', blogSettings],
      ['help', helpCenterSettings],
    ])

    addContentSiteIndex(structure, [
      ['blog', blogSettings],
      ['help', helpCenterSettings],
    ])

    return structure
  }
}

/**
 * The server-side module the category pages read from (see
 * `content-category-pages.ts`), emitted once for every preset whose settings
 * carry `categoryPages` and whose posts table has a fetcher. A preset whose
 * data source the UIDL does not carry gets no functions: its page would have
 * nothing to read, and the editor emits `categoryPages` only with one.
 */
function addContentCategoryPages(
  structure: ProjectPluginStructure,
  candidates: Array<[ContentTables.ContentPresetKey, UIDLBlogSettings | undefined]>
): void {
  const { uidl, files } = structure
  const presets: ContentCategoryPagesPreset[] = []
  for (const [key, settings] of candidates) {
    const categoryPages = settings?.categoryPages
    if (!categoryPages) {
      continue
    }
    const dataSource = uidl.dataSources?.[categoryPages.dataSourceId]
    if (!dataSource) {
      continue
    }
    const fetcherModule = ensureDataSourceUtilityModule(structure, {
      dataSourceId: categoryPages.dataSourceId,
      dataSourceType: dataSource.type,
      tableName: ContentTables.contentTablesByKey(key).posts,
    })
    if (!fetcherModule) {
      continue
    }
    presets.push({
      key,
      settings: categoryPages,
      fetcherModule,
      arranged: settings?.order === 'manual',
    })
  }
  if (presets.length === 0) {
    return
  }
  files.set('content-category-pages', {
    path: [],
    files: [
      {
        name: 'content-category-pages',
        fileType: FileType.JS,
        content: generateContentCategoryPagesSource(presets),
      },
    ],
  })
}

// tslint:disable-next-line:no-any
function projectReferencesBlogContext(files: Map<string, any>): boolean {
  for (const [, record] of Array.from(files.entries())) {
    for (const file of record.files || []) {
      if (typeof file.content === 'string' && file.content.includes(BLOG_CONTEXT_MODULE)) {
        return true
      }
    }
  }
  return false
}
