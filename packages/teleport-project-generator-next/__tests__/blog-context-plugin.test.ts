import { FileType, ProjectPluginStructure, UIDLBlogSettings } from '@teleporthq/teleport-types'
import { NextBlogProjectPlugin } from '../src/blog/project-plugin'

/**
 * The blog's post-category taxonomy is baked into `blog-context.js` and read
 * through `useBlogCategories()` — the listing's category filter and the
 * post-details breadcrumbs are array mappers over it.
 *
 * Two emission rules, and the second is the one that keeps a build green: a
 * component can import the hook on a project whose `blogSettings` did not
 * survive (the same way a nav cart counter can import `useEcommerce` without
 * `ecommerceSettings`), and without the file that import dangles and
 * `next build` fails with "Module not found".
 */

const NAV_WITHOUT_HOOK = 'export default function Nav() { return null }'
const NAV_WITH_HOOK = [
  "import { useBlogCategories } from '@/blog-context'",
  'export default function Nav() { return null }',
].join('\n')

const buildStructure = (params: {
  componentContent: string
  blogSettings?: UIDLBlogSettings
}): ProjectPluginStructure => {
  const files = new Map<string, { path: string[]; files: Array<Record<string, unknown>> }>()
  files.set('navigation', {
    path: ['components'],
    files: [{ name: 'navigation', fileType: FileType.JS, content: params.componentContent }],
  })
  return {
    uidl: {
      globals: { env: {} },
      ...(params.blogSettings ? { blogSettings: params.blogSettings } : {}),
    },
    files,
    dependencies: {},
    devDependencies: {},
  } as unknown as ProjectPluginStructure
}

const findContext = (structure: ProjectPluginStructure) =>
  structure.files.get('blog-context')?.files?.[0] as { content: string } | undefined

describe('NextBlogProjectPlugin', () => {
  it('bakes the taxonomy behind a memoized, locale-aware hook', async () => {
    const structure = buildStructure({
      componentContent: NAV_WITHOUT_HOOK,
      blogSettings: {
        categories: [
          {
            id: 'news',
            name: 'News',
            slug: 'news',
            parentId: null,
            order: 0,
            children: [],
            translations: { fr: { name: 'Actus' } },
          },
        ],
      },
    })

    await new NextBlogProjectPlugin().runAfter(structure)

    const context = findContext(structure)
    expect(context).toBeDefined()
    expect(context!.content).toContain('export const useBlogCategories')
    expect(context!.content).toContain(
      'resolveCategoryTranslations(BLOG_CATEGORIES, router.locale)'
    )
    expect(context!.content).toContain('"Actus"')
    // No provider: the tree is static, so nothing has to wrap `_app`.
    expect(context!.content).not.toContain('createContext')
  })

  it('emits an EMPTY taxonomy for a blog that has no categories yet', async () => {
    const structure = buildStructure({
      componentContent: NAV_WITHOUT_HOOK,
      blogSettings: { categories: [] },
    })

    await new NextBlogProjectPlugin().runAfter(structure)

    expect(findContext(structure)!.content).toContain('const BLOG_CATEGORIES = []')
  })

  it('backstops a dangling import when the project carries no blogSettings', async () => {
    const structure = buildStructure({ componentContent: NAV_WITH_HOOK })

    await new NextBlogProjectPlugin().runAfter(structure)

    const context = findContext(structure)
    expect(context).toBeDefined()
    expect(context!.content).toContain('const BLOG_CATEGORIES = []')
  })

  it('leaves a project that never references the hook untouched', async () => {
    const structure = buildStructure({ componentContent: NAV_WITHOUT_HOOK })

    await new NextBlogProjectPlugin().runAfter(structure)

    expect(findContext(structure)).toBeUndefined()
  })
})
