import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { generateBlogContextFileContent } from './blog-context-generator'

/** The import specifier the generated blog pages resolve `useBlogCategories` from. */
const BLOG_CONTEXT_MODULE = '@/blog-context'

/**
 * Emits the generated `blog-context.js` module — the blog's baked category
 * taxonomy behind `useBlogCategories()` (see `blog-context-generator.ts`).
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

    if (!blogSettings && !projectReferencesBlogContext(files)) {
      return structure
    }

    files.set('blog-context', {
      path: [],
      files: [
        {
          name: 'blog-context',
          fileType: FileType.JS,
          content: generateBlogContextFileContent(blogSettings),
        },
      ],
    })

    return structure
  }
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
