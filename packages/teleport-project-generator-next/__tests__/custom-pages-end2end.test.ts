import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import customPagesFixture from './__fixtures__/custom-pages-uidl.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

/**
 * Custom Pages: `/pages/[slug]` and the two components that render it — the
 * part of the feature nobody can read before it ships.
 *
 * Everything else the feature builds is inspectable in the editor. These three
 * files are not: they are generated, locked, and only prove themselves as
 * emitted Next.js code. So the fixture is not invented — `__fixtures__/
 * custom-pages-uidl.json` is what the GUI's `domainProjectToUIDL` actually
 * produces for a project with one `Hero` component (a text prop and a rich-text
 * prop), captured whole: the route, the page node, the `custom-page-block` and
 * `custom-page-section` components and the two resource fetchers.
 *
 *   page          repeater(parse(props.teleportPage?.blocks))
 *                   block?.component === 'tq:section'  → <CustomPageSection block={block} />
 *                   block?.component !== 'tq:section'  → <CustomPageBlock block={block} />
 *   block comp    one gated branch per registry entry (built-in elements + Hero)
 *   section comp  a band + grid styled from the row → repeater(block.children) → <CustomPageBlock />
 *
 * The assertions guard failures that are INVISIBLE in the editor: a repeater
 * source that is not parse-wrapped renders nothing at all, a missing
 * `revalidate` freezes the page until the next redeploy, a scalar prop that
 * gained a fallback would overwrite a deliberately stored `false`/`''`, a
 * reference the generator cannot resolve becomes a `ReferenceError` on the
 * first server render, and a per-row SEO override that never reaches the head
 * ships every page indexed and canonicalised to itself.
 */

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const DATA_SOURCE_ID = 'ds-custom-pages'
const TABLE_NAME = 'teleport_pages'
const ENTITY = 'teleportPage'
const REVALIDATE_SECONDS = 60
const SECTION_ID = 'tq:section'

interface Fixture {
  route: Record<string, unknown>
  pageNode: Record<string, unknown>
  components: Record<string, Record<string, unknown>>
  resources: { items: Record<string, unknown>; cache?: unknown }
}

const fixture = customPagesFixture as unknown as Fixture

/** The `Hero` component's id, read off the fixture rather than pinned. */
const HERO_ID = (() => {
  const text = JSON.stringify(fixture.components['custom-page-block'])
  const match = text.match(/"data-tq-block-branch":\{"type":"static","content":"(TQ_[^"]+)"\}/)
  if (!match) {
    throw new Error('fixture: no component branch found in custom-page-block')
  }
  return match[1]
})()

interface FixtureOptions {
  /**
   * The project-global `resources.cache`. Left out, the UIDL decoder defaults it
   * to `{ revalidate: 60 }` — which is exactly the accident the per-page cache
   * exists to not depend on.
   */
  globalCache?: unknown
  /** Drop `initialPropsData.cache`, i.e. the pre-ISR-floor GUI output. */
  withoutPerPageCache?: boolean
}

const buildCustomPagesUidl = (options: FixtureOptions = {}): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const route = JSON.parse(JSON.stringify(fixture.route)) as Record<string, unknown>
  const pageOptions = route.pageOptions as { initialPropsData: { cache?: unknown } }
  if (options.withoutPerPageCache) {
    delete pageOptions.initialPropsData.cache
  }

  // Without this the data-source utility module the two resource files import
  // is never emitted and the project would not build.
  uidl.dataSources = {
    [DATA_SOURCE_ID]: {
      id: DATA_SOURCE_ID,
      name: 'Test DB',
      type: 'teleport',
      config: {
        selectedTables: {
          [TABLE_NAME]: {
            name: TABLE_NAME,
            columns: [
              { name: 'id', type: 'uuid' },
              { name: 'title', type: 'varchar' },
              { name: 'slug', type: 'varchar' },
              { name: 'status', type: 'varchar' },
              { name: 'blocks', type: 'text' },
              { name: 'meta_title', type: 'varchar' },
              { name: 'meta_description', type: 'text' },
            ],
          },
        },
      },
    },
  } as never

  uidl.resources = {
    items: JSON.parse(JSON.stringify(fixture.resources.items)),
    resourceMappers: {},
    ...(options.globalCache === undefined ? {} : { cache: options.globalCache }),
  } as never

  uidl.components = {
    ...(uidl.components || {}),
    ...(JSON.parse(JSON.stringify(fixture.components)) as ProjectUIDL['components']),
  }

  uidl.root.stateDefinitions?.route.values?.push(route as never)
  uidl.root.node.content.children?.push(JSON.parse(JSON.stringify(fixture.pageNode)) as never)

  return uidl
}

interface Generated {
  page: string
  blockComponent: string
  sectionComponent: string
  dataSourceApi: string
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

const findFileContaining = (folder: GeneratedFolder, needle: string): string => {
  for (const file of folder.files) {
    if (String(file.content).includes(needle)) {
      return String(file.content)
    }
  }
  for (const sub of folder.subFolders) {
    const found = findFileContaining(sub, needle)
    if (found) {
      return found
    }
  }
  return ''
}

const generate = async (options?: FixtureOptions): Promise<Generated> => {
  const generator = createNextProjectGenerator()
  const outputFolder = await generator.generateProject(buildCustomPagesUidl(options), template)
  return {
    page: findFile(outputFolder, ['pages', 'pages', '[slug]']),
    blockComponent: findFile(outputFolder, ['components', 'custom-page-block']),
    sectionComponent: findFile(outputFolder, ['components', 'custom-page-section']),
    dataSourceApi: findFileContaining(outputFolder, 'function buildCustomPage('),
  }
}

/**
 * Every identifier the emitted module reads without ever declaring it.
 *
 * This is the `next build` guard: an unresolved reference does not throw at
 * generation time, it becomes a bare name in the JSX and the route dies with
 * `ReferenceError: <name> is not defined` on the first server render.
 */
const collectUndeclaredIdentifiers = (code: string): string[] => {
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] })
  const globals = new Set([
    'React',
    'JSON',
    'Array',
    'Object',
    'String',
    'Number',
    'Boolean',
    'Math',
    'Date',
    'console',
    'undefined',
    'process',
    'window',
    'document',
    'require',
    'module',
    'exports',
  ])
  const found = new Set<string>()

  traverse(ast, {
    ReferencedIdentifier(path: {
      node: { name: string }
      scope: { hasBinding: (n: string) => boolean }
    }) {
      const { name } = path.node
      if (globals.has(name) || path.scope.hasBinding(name)) {
        return
      }
      found.add(name)
    },
  } as never)

  return [...found]
}

/** `props.block?.props?.heading` or `props.block?.["props"]?.["heading"]` — the quoting is the generator's. */
const propPath = (...segments: string[]): RegExp =>
  new RegExp(
    ['props\\.block']
      .concat(
        segments.map((segment) => `\\?\\.(?:${segment}|\\["${segment}"\\]|\\['${segment}'\\])`)
      )
      .join('')
  )

describe('Next generator — Custom Pages', () => {
  let generated: Generated

  beforeAll(async () => {
    generated = await generate()
  }, 60_000)

  describe('/pages/[slug]', () => {
    it('server-fetches the published row by the slug route param and 404s when it is missing', () => {
      const { page } = generated
      expect(page).toContain('export async function getStaticProps')
      expect(page).toMatch(/source:\s*'slug',\s*destination:\s*params\['slug'\]/)
      expect(page).toMatch(/source:\s*'status',\s*destination:\s*'published'/)
      expect(page).toContain('notFound: true')
    })

    it("pre-renders known slugs and serves brand-new ones with fallback: 'blocking'", () => {
      const { page } = generated
      expect(page).toContain('export async function getStaticPaths')
      expect(page).toMatch(/fallback:\s*['"]blocking['"]/)
    })

    it('pre-renders only published rows that do not redirect', () => {
      // Next fails the WHOLE build on a `redirect` returned from getStaticProps
      // while prerendering; a redirected row is served on demand instead. A
      // draft would only be pre-rendered into a 404.
      const { page } = generated
      expect(page).toMatch(
        /fetchTeleportPagesPathsResource\(\{\s*filters:\s*'\[.*"source":"status".*"source":"redirect_url","destination":null.*\]'/s
      )
    })

    it('emits the ISR floor so an admin edit converges without a redeploy', () => {
      expect(generated.page).toMatch(new RegExp(`revalidate:\\s*${REVALIDATE_SECONDS}`))
    })

    it('keeps the ISR floor when the project-global resources cache carries no revalidate', async () => {
      const { page } = await generate({ globalCache: { staleWhileRevalidate: 30 } })
      expect(page).toMatch(new RegExp(`revalidate:\\s*${REVALIDATE_SECONDS}`))
    })

    it('answers the row’s own redirect before rendering, with a real 301/302', () => {
      const { page } = generated
      expect(page).toContain('redirectUrl')
      expect(page).toContain('redirectType')
      expect(page).toMatch(/statusCode:/)
      expect(page).not.toMatch(/permanent:\s*(true|false)/)
    })

    it('reads the JSON column through the parse IIFE and draws the two components', () => {
      const { page } = generated
      expect(page).toContain(`(function (__tqJsonArray)`)
      expect(page).toContain(`props.${ENTITY}?.blocks`)
      expect(page).toContain(`block?.component === '${SECTION_ID}'`)
      expect(page).toContain(`block?.component !== '${SECTION_ID}'`)
      expect(page).toMatch(/<CustomPageSection\s+block=\{block\}/)
      expect(page).toMatch(/<CustomPageBlock\s+block=\{block\}/)
      expect(page).toMatch(
        /import CustomPageSection from ['"]\.\.\/\.\.\/components\/custom-page-section['"]/
      )
      expect(page).toMatch(
        /import CustomPageBlock from ['"]\.\.\/\.\.\/components\/custom-page-block['"]/
      )
    })

    it('binds the head to the row: title, robots with the page fallback, og tags, canonical override', () => {
      const { page } = generated
      expect(page).toContain(`props?.${ENTITY}?.metaTitle`)
      expect(page).toContain(`props?.${ENTITY}?.metaDescription`)
      expect(page).toMatch(
        new RegExp(`props\\?\\.${ENTITY}\\?\\.robotsContent \\?\\? ['"]index, follow['"]`)
      )
      expect(page).toContain(`props?.${ENTITY}?.ogTitle`)
      expect(page).toContain(`props?.${ENTITY}?.ogDescription`)
      expect(page).toContain(`props?.${ENTITY}?.ogImage`)
      expect(page).toMatch(new RegExp(`props\\?\\.${ENTITY}\\?\\.canonicalUrl \\|\\|`))
      // Exactly one robots tag: crawlers obey the most restrictive of two.
      expect(page.match(/name="robots"/g)).toHaveLength(1)
    })

    it('leaves no reference as a bare identifier (SSR ReferenceError guard)', () => {
      expect(collectUndeclaredIdentifiers(generated.page)).toEqual([])
    })

    it('puts nothing but a key on a Fragment', () => {
      // The repeater's item root is a Fragment and React accepts only `key`
      // (and `children`) on it — a marker attribute leaking from the mapper
      // would warn on every block row.
      expect(generated.page).not.toMatch(/<Fragment\s+(?!key=)[a-zA-Z]/)
    })
  })

  describe('custom-page-block', () => {
    it('gates one branch per registry entry on the block prop, the project component included', () => {
      const { blockComponent } = generated
      expect(blockComponent).toMatch(propPath('component'))
      expect(blockComponent).toContain(`'${HERO_ID}'`)
      for (const id of [
        'tq:heading',
        'tq:text',
        'tq:rich-text',
        'tq:image',
        'tq:button',
        'tq:video',
        'tq:separator',
        'tq:spacer',
      ]) {
        expect(blockComponent).toContain(`'${id}'`)
      }
    })

    it('binds the component’s scalar prop straight to the row, and its rich text through dangerouslySetInnerHTML', () => {
      const { blockComponent } = generated
      expect(blockComponent).toMatch(/import Hero from ['"]\.\/hero['"]/)
      expect(blockComponent).toMatch(
        new RegExp(`<Hero\\s[^>]*heading=\\{${propPath('props', 'heading').source}\\}`)
      )
      expect(blockComponent).not.toMatch(
        new RegExp(`${propPath('props', 'heading').source}\\s*(\\|\\||\\?\\?)`)
      )
      expect(blockComponent).toContain('dangerouslySetInnerHTML')
      expect(blockComponent).toMatch(propPath('props', 'story'))
    })

    it('renders the built-in elements from the row: six heading levels, inline styles from the props', () => {
      const { blockComponent } = generated
      for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        expect(blockComponent).toContain(`<${tag}`)
      }
      expect(blockComponent).toMatch(/textAlign:\s*props\.block/)
      expect(blockComponent).toMatch(/backgroundColor:\s*props\.block/)
      expect(blockComponent).toMatch(/maxWidth:\s*props\.block/)
      expect(blockComponent).toMatch(/<video/)
      expect(blockComponent).toMatch(/<hr/)
    })

    it('declares the block prop with a real default so an unbound instance matches no branch', () => {
      expect(generated.blockComponent).toMatch(
        /block:\s*\{\s*id:\s*['"]{2},\s*component:\s*['"]{2}/
      )
    })

    it('leaves no reference as a bare identifier', () => {
      expect(collectUndeclaredIdentifiers(generated.blockComponent)).toEqual([])
    })
  })

  describe('custom-page-section', () => {
    it('maps the row’s children through the parse wrapper into one block per child', () => {
      const { sectionComponent } = generated
      expect(sectionComponent).toContain('(function (__tqJsonArray)')
      expect(sectionComponent).toMatch(/props\['block'\]\?\.\['children'\]/)
      expect(sectionComponent).toMatch(/<CustomPageBlock\s+block=\{sectionBlock\}/)
    })

    it('styles the band and the grid from the row’s own CSS values', () => {
      const { sectionComponent } = generated
      expect(sectionComponent).toMatch(/gridTemplateColumns:\s*props\.block/)
      expect(sectionComponent).toMatch(/gap:\s*props\.block/)
      expect(sectionComponent).toMatch(/padding:\s*props\.block/)
      expect(sectionComponent).toMatch(/backgroundColor:\s*props\.block/)
    })

    it('leaves no reference as a bare identifier', () => {
      expect(collectUndeclaredIdentifiers(generated.sectionComponent)).toEqual([])
    })
  })

  describe('the data-source route', () => {
    it('runs every fetched row through the custom-page transform', () => {
      expect(generated.dataSourceApi).toContain('function buildCustomPage(')
      expect(generated.dataSourceApi).toContain('transformCustomPages(records, options)')
      expect(generated.dataSourceApi).toContain('robotsContent')
    })
  })
})
