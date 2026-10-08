import { parse } from '@babel/parser'
import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import { ContentTables } from '@teleporthq/teleport-shared'
import { generateSafeFileName } from '@teleporthq/teleport-plugin-next-data-source'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

/**
 * A content preset's CATEGORY PAGE end to end: the editor exports one dynamic
 * page at `/help/category/[slug]` whose `getStaticProps` / `getStaticPaths`
 * are EXTERNAL resources — two functions of the `content-category-pages`
 * module the blog project plugin emits — instead of a table fetch. Generated
 * code is the only place that contract proves itself: the page must import
 * the functions by the names teleport-shared derives, call the resolver with
 * the route's slug, expose the result as the page prop the page's bindings
 * read, 404 on an empty answer, and revalidate; the module must exist and read
 * the preset's posts through its generated fetcher.
 */

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const DATA_SOURCE_ID = 'ds-help-content'
const TABLE = ContentTables.contentTablesByKey('help').posts
const MODULE = ContentTables.CONTENT_CATEGORY_PAGES_MODULE
const RESOLVER = ContentTables.contentCategoryPageResolverName('help')
const LISTER = ContentTables.contentCategoryPathsListerName('help')
const ENTITY = 'helpCenterCategory'

const dependency = { type: 'local', path: MODULE, meta: { namedImport: true } }

const buildUidl = (): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL

  uidl.dataSources = {
    [DATA_SOURCE_ID]: {
      id: DATA_SOURCE_ID,
      name: 'Content',
      type: 'teleport',
      config: {
        selectedTables: {
          [TABLE]: {
            name: TABLE,
            columns: [
              { name: 'id', type: 'uuid' },
              { name: 'title', type: 'varchar' },
              { name: 'slug', type: 'varchar' },
              { name: 'status', type: 'varchar' },
              { name: 'category_filter_ids', type: 'text' },
            ],
          },
        },
      },
    },
  } as never

  // The editor emits the block for every project with a data source; the
  // category page registers no fetcher of its own in it.
  uidl.resources = { items: {}, resourceMappers: {} } as never

  uidl.helpCenterSettings = {
    categories: [
      { id: 'guides', name: 'Guides', slug: 'guides', parentId: null, order: 0, children: [] },
    ],
    categoryPages: {
      dataSourceId: DATA_SOURCE_ID,
      postPath: '/help',
      postUrlField: 'slug',
      categoryPath: '/help/category',
    },
  } as never

  const route = {
    value: 'help/category/Help-Category',
    pageId: 'TQ_help_category_page',
    seo: { title: 'Category' },
    pageOptions: {
      stateDefinitions: {},
      propDefinitions: {},
      navLink: '/help/category/[slug]',
      dynamicRouteAttribute: 'slug',
      initialPropsData: {
        exposeAs: { name: ENTITY, valuePath: ['data'] },
        resource: {
          name: RESOLVER,
          dependency,
          params: { slug: { type: 'expr', content: "params['slug']" } },
        },
        cache: { revalidate: 60 },
      },
      initialPathsData: {
        exposeAs: { name: `${ENTITY}Paths`, valuePath: ['data'], itemValuePath: ['slug'] },
        resource: { name: LISTER, dependency },
      },
    },
  }

  const pageNode = {
    type: 'conditional',
    content: {
      reference: { type: 'dynamic', content: { referenceType: 'state', id: 'route' } },
      value: 'help/category/Help-Category',
      node: {
        type: 'element',
        content: {
          elementType: 'container',
          children: [
            {
              type: 'element',
              content: {
                elementType: 'text',
                children: [
                  {
                    type: 'dynamic',
                    content: {
                      referenceType: 'prop',
                      id: ENTITY,
                      refPath: ['name'],
                      fallback: '',
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  }

  uidl.root.stateDefinitions?.route.values?.push(route as never)
  uidl.root.node.content.children?.push(pageNode as never)
  return uidl
}

const findFile = (folder: GeneratedFolder, path: string[]): string => {
  let current: GeneratedFolder | undefined = folder
  for (const segment of path.slice(0, -1)) {
    current = current?.subFolders.find((sub) => sub.name === segment)
  }
  const file = current?.files.find((entry) => entry.name === path[path.length - 1])
  expect(file).toBeDefined()
  return file?.content as string
}

const expectValidJs = (source: string) => {
  expect(() => parse(source, { sourceType: 'module', plugins: ['jsx'] })).not.toThrow()
}

describe('a content preset category page, generated', () => {
  let page: string
  let module: string
  let blogContext: string

  beforeAll(async () => {
    const generator = createNextProjectGenerator()
    const output = await generator.generateProject(buildUidl(), template)
    page = findFile(output, ['pages', 'help', 'category', '[slug]'])
    module = findFile(output, ['content-category-pages'])
    blogContext = findFile(output, ['blog-context'])
  })

  it('resolves the category at the slug through the generated module, as the page prop', () => {
    expectValidJs(page)
    expect(page).toMatch(
      new RegExp(
        `import \\{[\\s\\S]*\\b${RESOLVER}\\b[\\s\\S]*\\} from '${MODULE.replace('/', '\\/')}'`
      )
    )
    expect(page).toMatch(new RegExp(`await ${RESOLVER}\\(\\{[\\s\\S]*slug: params\\['slug'\\]`))
    expect(page).toMatch(
      /if \(!response\?\.data\) \{\s*return \{\s*notFound: true,\s*revalidate: 60/
    )
    expect(page).toContain(`${ENTITY}: response?.data`)
    // The page's text reads the prop the resolver exposed, however the
    // generator spells the optional chain.
    expect(page).toMatch(new RegExp(`props\\.${ENTITY}\\??\\.(\\['name'\\]|name)`))
  })

  it('lists every category slug for getStaticPaths through the module', () => {
    expect(page).toMatch(
      new RegExp(
        `import \\{[\\s\\S]*\\b${LISTER}\\b[\\s\\S]*\\} from '${MODULE.replace('/', '\\/')}'`
      )
    )
    expect(page).toContain(`await ${LISTER}(`)
    expect(page).toContain("fallback: 'blocking'")
  })

  it('emits the module over the baked taxonomy and the preset’s posts fetcher', () => {
    expectValidJs(module)
    expect(module).toContain(`export async function ${RESOLVER}(params)`)
    expect(module).toContain(`export async function ${LISTER}()`)
    expect(module).toContain(
      `import helpPosts from './utils/data-sources/${generateSafeFileName(
        'teleport',
        TABLE,
        DATA_SOURCE_ID
      )}'`
    )
    expect(module).toContain("from '@/blog-context'")
    expect(blogContext).toContain('export const HELP_CATEGORY_TREE')
    expect(blogContext).toContain('export const localizeCategoryTree')
  })
})
