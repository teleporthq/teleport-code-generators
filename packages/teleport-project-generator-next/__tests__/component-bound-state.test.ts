/* tslint:disable:function-constructor no-any */
import generator from '@babel/generator'
import * as types from '@babel/types'
import { GeneratedFolder } from '@teleporthq/teleport-types'
import { generateSafeFileName } from '@teleporthq/teleport-plugin-next-data-source'
import {
  ADMIN_TABLE,
  COMPONENT_STATE_FOLDER,
  DATA_SOURCE_ID,
  SUBSCRIPTION_PRODUCT,
  bootComponentStateRoute,
  bootReadRoute,
  buildDataExposureUidl,
  componentStateRoutesOf,
  fileText,
} from './_helpers/data-exposure-fixture'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'
import { createComponentStateDataSourcePlugin } from '../src/state-data-source-plugin'

// A state bound to a data source belongs to a page or to a COMPONENT. A page's
// is handed to it by its own server-side fetch. A component's was declared as
// `useState(props.<state> !== undefined ? props.<state> : <default>)` and then
// never given a value: no page fetched it and no instance passed it, so a list
// over it stayed empty on the generated site while the editor showed its rows.
// The component now reads for itself: a table through the table's read route,
// a statement of its own through a route that holds the statement.
//
// The components are named as a project names them — by a dash-case key the
// generator turns into a class name (`studio-showcase` → `StudioShowcase`).

const PUBLIC_TABLE = 'studio_pieces'
const STAFF_ONLY_TABLE = 'staff_board'
const CATALOGUE_TABLE = 'teleport_products'

const BEST_SELLERS = `SELECT * FROM ${PUBLIC_TABLE} ORDER BY name LIMIT 3`
const FEATURED = `SELECT * FROM ${PUBLIC_TABLE} WHERE status = 'featured'`
const CATALOGUE = `SELECT id, name FROM ${CATALOGUE_TABLE} ORDER BY name`
const ORDERS = `SELECT id, name FROM ${ADMIN_TABLE}`
const MINE = `SELECT * FROM ${PUBLIC_TABLE} WHERE user_id = '{{Current User.id}}'`
const AGENDA = `SELECT * FROM ${STAFF_ONLY_TABLE} ORDER BY name`

const routeOf = (table: string): string => generateSafeFileName('teleport', table, DATA_SOURCE_ID)

const boundState = (
  type: string,
  defaultValue: unknown,
  refPath: Array<string | number>,
  extra: Record<string, unknown> = {}
) => ({
  type,
  defaultValue,
  dataSourceBinding: { dataSourceId: DATA_SOURCE_ID, refPath },
  ...extra,
})

const component = (name: string, stateDefinitions: Record<string, unknown>) => ({
  name,
  stateDefinitions,
  node: {
    type: 'element',
    content: { elementType: 'container', children: [{ type: 'static', content: name }] },
  },
})

const instanceOf = (name: string) => ({
  type: 'element',
  content: { elementType: 'component', semanticType: name, dependency: { type: 'local' } },
})

const statementState = (statement: string, table = PUBLIC_TABLE) =>
  boundState('array', [], [table], { query: statement })

const buildUidl = () => {
  const uidl = buildDataExposureUidl() as any
  const tables = uidl.dataSources[DATA_SOURCE_ID].config.selectedTables
  ;[PUBLIC_TABLE, STAFF_ONLY_TABLE].forEach((table) => {
    tables[table] = {
      name: table,
      columns: ['id', 'name', 'status'].map((name) => ({ name, type: 'text' })),
    }
  })

  const components: Record<string, Record<string, unknown>> = {
    'studio-showcase': {
      pieces: boundState('array', [], [PUBLIC_TABLE]),
      firstPiece: boundState('object', {}, [PUBLIC_TABLE, 0]),
      bestSellers: statementState(BEST_SELLERS),
      featured: boundState('object', {}, [PUBLIC_TABLE, 0], { query: FEATURED }),
      catalogue: statementState(CATALOGUE, CATALOGUE_TABLE),
      orders: statementState(ORDERS),
      mine: statementState(MINE),
    },
    'staff-board': {
      notes: boundState('array', [], [STAFF_ONLY_TABLE]),
      agenda: statementState(AGENDA, STAFF_ONLY_TABLE),
    },
    'team-badge': { rows: statementState(BEST_SELLERS) },
    'lesson-list': { rows: statementState(BEST_SELLERS) },
    'mixed-panel': { rows: statementState(BEST_SELLERS) },
    'order-totals': {
      rows: statementState(ORDERS),
      catalogue: statementState(CATALOGUE, CATALOGUE_TABLE),
    },
    'spare-part': { rows: statementState(BEST_SELLERS) },
  }
  Object.keys(components).forEach((name) => {
    uidl.components[name] = component(name, components[name])
  })

  const place = (page: string, name: string) =>
    uidl.root.node.content.children
      .find((child: any) => child.content.value === page)
      .content.node.content.children.push(instanceOf(name))
  // Every visitor may open the about page.
  place('about', 'studio-showcase')
  // The staff role only.
  place('staff', 'staff-board')
  // Any signed-in visitor, and the staff.
  place('account', 'team-badge')
  place('staff', 'team-badge')
  // Subscribers only.
  place('lessons', 'lesson-list')
  // The staff, or a subscriber.
  place('staff', 'mixed-panel')
  place('lessons', 'mixed-panel')
  // The admin panel only.
  place('admin/orders', 'order-totals')
  // `spare-part` is on no page.

  return uidl
}

const generate = async (): Promise<GeneratedFolder> => {
  const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder
  return createNextProjectGenerator().generateProject(buildUidl(), template)
}

/** The route `componentFile`'s component reads `statement` from. */
const statementRouteOf = (
  project: GeneratedFolder,
  componentFile: string,
  statement: string
): string => {
  const found = componentStateRoutesOf(project).filter(
    (name) =>
      name.indexOf(`${componentFile}-`) === 0 &&
      (fileText(project, COMPONENT_STATE_FOLDER, name) || '').includes(
        `var STATEMENT = ${JSON.stringify(statement)}`
      )
  )
  if (found.length !== 1) {
    throw new Error(`${found.length} routes for ${componentFile}: ${statement}`)
  }
  return found[0]
}

/** The effects of `source` that fill a state from a read route, as written. */
const stateEffectsOf = (source: string): Array<{ body: string; deps: string }> => {
  const effects: Array<{ body: string; deps: string }> = []
  const pattern = /useEffect\(\(\) => \{\n(\s+let __active = true[\s\S]*?)\n\s+\}, \[([^\]]*)\]\)/g
  let match = pattern.exec(source)
  while (match) {
    effects.push({ body: match[1], deps: match[2] })
    match = pattern.exec(source)
  }
  return effects
}

interface EffectRun {
  requests: string[]
  values: Record<string, unknown[]>
  errors: unknown[][]
  cleanup: () => void
  settle: () => Promise<void>
}

/** Runs one generated effect against a read route that answers `reply`. */
const runEffect = (
  body: string,
  setters: string[],
  reply: unknown,
  router?: { locale?: string }
): EffectRun => {
  const requests: string[] = []
  const errors: unknown[][] = []
  const values: Record<string, unknown[]> = {}
  setters.forEach((name) => (values[name] = []))
  const fetchStub = (url: string) => {
    requests.push(String(url))
    return reply instanceof Error
      ? Promise.reject(reply)
      : Promise.resolve({ json: () => Promise.resolve(reply) })
  }
  const cleanup = new Function('fetch', 'console', 'router', ...setters, body)(
    fetchStub,
    { error: (...args: unknown[]) => errors.push(args) },
    router,
    ...setters.map((name) => (value: unknown) => values[name].push(value))
  ) as () => void
  const settle = async () => {
    for (let turn = 0; turn < 6; turn++) {
      await Promise.resolve()
    }
  }
  return { requests, values, errors, cleanup, settle }
}

describe('a component state bound to a table, on the generated site', () => {
  let project: GeneratedFolder
  let showcase: string
  let warnings: string[]

  beforeAll(async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    project = await generate()
    warnings = warn.mock.calls.map((call) => String(call[0]))
    warn.mockRestore()
    showcase = fileText(project, ['components'], 'studio-showcase') || ''
  }, 120000)

  /** The effect of the showcase that reads its table. */
  const tableEffect = () =>
    stateEffectsOf(showcase).filter((effect) => effect.body.includes('__query'))

  it('is read by the component itself, once, for every state of the same table', () => {
    const effects = tableEffect()

    expect(effects).toHaveLength(1)
    expect(effects[0].body).toContain('fetch(`/api/' + routeOf(PUBLIC_TABLE) + '?$' + '{__query}`)')
    expect(effects[0].deps).toBe('')
    expect(showcase).toMatch(/import React, \{[^}]*\buseEffect\b[^}]*\} from 'react'/)
    // Still takes a value a parent hands it.
    expect(showcase).toContain('props.pieces !== undefined ? props.pieces : []')
  })

  it('fills the list and the single row from what the route answers', async () => {
    const rows = [
      { id: 'p1', name: 'Blue necklace' },
      { id: 'p2', name: 'Green necklace' },
    ]
    const run = runEffect(tableEffect()[0].body, ['setPieces', 'setFirstPiece'], {
      success: true,
      data: rows,
    })
    await run.settle()

    expect(run.requests).toEqual([`/api/${routeOf(PUBLIC_TABLE)}?`])
    expect(run.values.setPieces).toEqual([rows])
    expect(run.values.setFirstPiece).toEqual([rows[0]])
    expect(run.errors).toEqual([])
  })

  it('keeps the states as they are when the route refuses, fails or answers late', async () => {
    const body = tableEffect()[0].body
    const setters = ['setPieces', 'setFirstPiece']

    const refused = runEffect(body, setters, { success: false, error: 'Unauthenticated' })
    await refused.settle()
    expect(refused.values).toEqual({ setPieces: [], setFirstPiece: [] })

    const failed = runEffect(body, setters, new Error('offline'))
    await failed.settle()
    expect(failed.values).toEqual({ setPieces: [], setFirstPiece: [] })
    expect(failed.errors).toHaveLength(1)
    expect(failed.errors[0][0]).toBe('Error fetching component state (pieces, firstPiece):')

    const unmounted = runEffect(body, setters, { success: true, data: [{ id: 'p1' }] })
    unmounted.cleanup()
    await unmounted.settle()
    expect(unmounted.values).toEqual({ setPieces: [], setFirstPiece: [] })
  })

  it('never puts anything but a list into a list, or a missing row into an object', async () => {
    const run = runEffect(tableEffect()[0].body, ['setPieces', 'setFirstPiece'], {
      success: true,
      data: { unexpected: true },
    })
    await run.settle()

    expect(run.values.setPieces).toEqual([[]])
    expect(run.values.setFirstPiece).toEqual([{}])
  })

  // THE DEFECT: with the component named as a project names it, the table it
  // alone reads was taken for one no page binds, and every visitor was refused.
  it('THE DEFECT: reads through a route every visitor may call when a page every visitor opens shows it', async () => {
    const reply = await bootReadRoute(project, routeOf(PUBLIC_TABLE))({})

    expect(reply.status).toBe(200)
    expect(reply.body.success).toBe(true)
    expect(reply.body.data).toHaveLength(1)
    expect(reply.body.data[0]).not.toHaveProperty('password')
  })

  it('reads through a route only the page’s sessions may call when only a protected page shows it', async () => {
    const staffBoard = fileText(project, ['components'], 'staff-board') || ''
    expect(
      stateEffectsOf(staffBoard).filter((effect) => effect.body.includes('__query'))
    ).toHaveLength(1)

    const route = bootReadRoute(project, routeOf(STAFF_ONLY_TABLE))
    expect((await route({})).status).toBe(401)
    expect((await route({ session: { role: 'user' } })).status).toBe(403)
    expect((await route({ session: { role: 'staff' } })).status).toBe(200)
  })

  it('leaves the page that shows the component as it was: no fetch of its own for it', () => {
    const about = fileText(project, ['pages'], 'about') || ''

    expect(about).toContain('<StudioShowcase>')
    expect(about).not.toContain('pieces')
  })

  it('leaves a statement that names the signed-in visitor to a workflow, and says so', () => {
    expect(showcase).not.toContain('setMine(')
    expect(
      JSON.stringify(
        componentStateRoutesOf(project).map((name) =>
          fileText(project, COMPONENT_STATE_FOLDER, name)
        )
      )
    ).not.toContain('Current User')
    expect(
      warnings.filter((warning) => /Component "studio-showcase": "mine" is filled/.test(warning))
    ).toHaveLength(1)
  })
})

describe('a component state filled by an SQL statement, on the generated site', () => {
  let project: GeneratedFolder
  let showcase: string

  beforeAll(async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    project = await generate()
    warn.mockRestore()
    showcase = fileText(project, ['components'], 'studio-showcase') || ''
  }, 120000)

  const boot = (componentFile: string, statement: string, rows?: any[]) =>
    bootComponentStateRoute(project, statementRouteOf(project, componentFile, statement), rows)

  /** The effect of `source` that reads `route`. */
  const effectReading = (source: string, route: string) =>
    stateEffectsOf(source).filter((effect) =>
      effect.body.includes(`fetch('/api/component-state/${route}')`)
    )

  it('is read by the component itself, from a route of its own that the request hands nothing', async () => {
    const route = statementRouteOf(project, 'studio-showcase', BEST_SELLERS)
    const effects = effectReading(showcase, route)

    expect(effects).toHaveLength(1)
    expect(effects[0].deps).toBe('')
    expect(effects[0].body).not.toContain('__query')
    // The statement is the server's: none of it is in the component.
    expect(showcase).not.toContain('ORDER BY name LIMIT 3')

    const rows = [{ id: 'p1', name: 'Blue necklace' }]
    const run = runEffect(effects[0].body, ['setBestSellers'], { success: true, data: rows })
    await run.settle()
    expect(run.requests).toEqual([`/api/component-state/${route}`])
    expect(run.values.setBestSellers).toEqual([rows])
  })

  it('fills a single row from the first row the statement answers', async () => {
    const route = statementRouteOf(project, 'studio-showcase', FEATURED)
    const [effect] = effectReading(showcase, route)

    const found = runEffect(effect.body, ['setFeatured'], {
      success: true,
      data: [{ id: 'p7', name: 'Gold ring' }],
    })
    await found.settle()
    expect(found.values.setFeatured).toEqual([{ id: 'p7', name: 'Gold ring' }])

    const none = runEffect(effect.body, ['setFeatured'], { success: true, data: [] })
    await none.settle()
    expect(none.values.setFeatured).toEqual([{}])

    const refused = runEffect(effect.body, ['setFeatured'], { success: false, error: 'Forbidden' })
    await refused.settle()
    expect(refused.values.setFeatured).toEqual([])
  })

  it('answers every visitor when a page every visitor may open shows the component', async () => {
    const reply = await boot('studio-showcase', BEST_SELLERS)({})

    expect(reply.status).toBe(200)
    expect(reply.body.success).toBe(true)
    expect(reply.queries).toEqual([BEST_SELLERS])
    expect(reply.body.data).toHaveLength(1)
    expect(reply.body.data[0]).toMatchObject({ id: 'r1', name: 'Row' })
    expect(reply.body.data[0]).not.toHaveProperty('password')
  })

  it('runs its own statement whatever the request names', async () => {
    const reply = await boot(
      'studio-showcase',
      BEST_SELLERS
    )({
      query: {
        rawQuery: `SELECT * FROM ${ADMIN_TABLE}`,
        query: `SELECT * FROM ${ADMIN_TABLE}`,
        tableName: ADMIN_TABLE,
        filters: JSON.stringify([{ field: 'status', operator: 'equals', value: 'x' }]),
        limit: '100000',
      },
    })

    expect(reply.status).toBe(200)
    expect(reply.queries).toEqual([BEST_SELLERS])
  })

  it('hands a browser no more rows than a read route does', async () => {
    const many = Array.from({ length: 600 }, (_, index) => ({ id: `r${index}`, name: 'Row' }))
    const reply = await boot('studio-showcase', BEST_SELLERS, many)({})

    expect(reply.body.data).toHaveLength(500)
  })

  it('answers only the sessions of the protected page that shows the component', async () => {
    const route = boot('staff-board', AGENDA)

    const anonymous = await route({})
    expect(anonymous.status).toBe(401)
    expect(anonymous.body).toMatchObject({ success: false, error: 'Unauthenticated' })
    expect(anonymous.queries).toEqual([])

    const member = await route({ session: { role: 'member' } })
    expect(member.status).toBe(403)
    expect(member.queries).toEqual([])

    const staff = await route({ session: { role: 'staff' } })
    expect(staff.status).toBe(200)
    expect(staff.queries).toEqual([AGENDA])
  })

  it('answers whoever one of its pages admits, when several show the component', async () => {
    const route = boot('team-badge', BEST_SELLERS)

    expect((await route({})).status).toBe(401)
    expect((await route({ session: { role: 'member' } })).status).toBe(200)
    expect((await route({ session: { role: 'staff' } })).status).toBe(200)
  })

  it('asks a subscriber-only page’s visitors for the subscription the page asks for', async () => {
    const route = boot('lesson-list', BEST_SELLERS)

    expect((await route({})).status).toBe(401)
    expect((await route({ session: { role: 'member' } })).status).toBe(403)
    const subscriber = await route({ session: { role: 'member' }, entitled: true })
    expect(subscriber.status).toBe(200)
    expect(subscriber.params[0]).toEqual(
      expect.arrayContaining([expect.arrayContaining([SUBSCRIPTION_PRODUCT])])
    )
  })

  it('admits by either page when one asks for a role and the other for a subscription', async () => {
    const route = boot('mixed-panel', BEST_SELLERS)

    expect((await route({ session: { role: 'staff' } })).status).toBe(200)
    expect((await route({ session: { role: 'member' }, entitled: true })).status).toBe(200)
    expect((await route({ session: { role: 'member' } })).status).toBe(403)
    expect((await route({})).status).toBe(401)
  })

  it('answers no browser for a component no page shows', async () => {
    const route = boot('spare-part', BEST_SELLERS)

    expect((await route({})).status).toBe(401)
    for (const role of ['member', 'staff', 'admin']) {
      const reply = await route({ session: { role } })
      expect([role, reply.status, reply.queries]).toEqual([role, 403, []])
    }
  })

  it('serves what a page that shows the component would: the rows a visitor is served', async () => {
    const reply = await boot('studio-showcase', CATALOGUE)({})

    expect(reply.status).toBe(200)
    expect(reply.queries).toHaveLength(1)
    // The catalogue read for a visitor: the statement runs over the rows the
    // storefront publishes, not over the table.
    expect(reply.queries[0]).toMatch(
      new RegExp(
        `^WITH "${CATALOGUE_TABLE}" AS \\(SELECT .* FROM "${CATALOGUE_TABLE}" AS __brp_rows WHERE \\(`
      )
    )
    expect(reply.queries[0].endsWith(CATALOGUE)).toBe(true)
  })

  it('serves a visitor nothing of a table a visitor may not read', async () => {
    const reply = await boot('studio-showcase', ORDERS)({})

    expect(reply.status).toBe(500)
    expect(reply.body.success).toBe(false)
    expect(reply.body.error).toBe('Failed to fetch data')
    expect(reply.body).not.toHaveProperty('data')
    expect(reply.queries).toEqual([])
  })

  it('reads as the store for a component only the admin panel shows — and only for its readers', async () => {
    const orders = boot('order-totals', ORDERS)

    expect((await orders({})).status).toBe(401)
    expect((await orders({ session: { role: 'staff' } })).status).toBe(403)
    const admin = await orders({ session: { role: 'admin' } })
    expect(admin.status).toBe(200)
    expect(admin.queries).toEqual([ORDERS])
    expect(admin.body.data).toHaveLength(1)

    // The whole catalogue, drafts included: what the admin page itself reads.
    const catalogue = await boot('order-totals', CATALOGUE)({ session: { role: 'admin' } })
    expect(catalogue.queries).toEqual([CATALOGUE])
  })

  it('keeps one route per component and statement, each beside the data-source module it runs through', () => {
    const routes = componentStateRoutesOf(project)

    expect(routes.filter((name) => name.indexOf('studio-showcase-') === 0)).toHaveLength(4)
    expect(routes.filter((name) => name.indexOf('order-totals-') === 0)).toHaveLength(2)
    for (const name of routes) {
      const source = fileText(project, COMPONENT_STATE_FOLDER, name) || ''
      const imported =
        /import dataSourceModule from '\.\.\/\.\.\/\.\.\/utils\/data-sources\/([^']+)'/.exec(source)
      expect([
        name,
        !!imported && fileText(project, ['utils', 'data-sources'], imported[1]) !== null,
      ]).toEqual([name, true])
    }
  })
})

describe('the component state plugin', () => {
  const CSV_ID = 'csv-0001'
  const I18N = {
    main: { name: 'English', locale: 'en' },
    languages: { en: 'English', es: 'Spanish' },
  }

  const run = async (
    stateDefinitions: Record<string, unknown>,
    options: Record<string, unknown> = {}
  ) => {
    const structure = {
      uidl: {
        name: 'Showcase',
        stateDefinitions,
        node: { type: 'element', content: { elementType: 'container' } },
      },
      chunks: [
        {
          type: 'AST',
          fileType: 'js',
          name: 'jsx-component',
          linkAfter: [] as string[],
          content: types.variableDeclaration('const', [
            types.variableDeclarator(
              types.identifier('Showcase'),
              types.arrowFunctionExpression(
                [types.identifier('props')],
                types.blockStatement([types.returnStatement(types.nullLiteral())])
              )
            ),
          ]),
        },
      ] as any[],
      dependencies: {} as Record<string, any>,
      options: {
        dataSources: {
          [DATA_SOURCE_ID]: { id: DATA_SOURCE_ID, type: 'teleport', config: {} },
          [CSV_ID]: {
            id: CSV_ID,
            type: 'csv-file',
            config: { columns: [{ id: 'col_1', label: 'Name' }], parsedData: [{ col_1: 'Ada' }] },
          },
        },
        // The route is there already, so the test does not depend on its generation.
        extractedResources: {
          [`api/${routeOf(PUBLIC_TABLE)}`]: { fileName: routeOf(PUBLIC_TABLE), content: '// stub' },
          [`api/${generateSafeFileName('csv-file', 'data', CSV_ID)}`]: {
            fileName: generateSafeFileName('csv-file', 'data', CSV_ID),
            content: '// stub',
          },
        } as Record<string, any>,
        ...options,
      },
    }
    await createComponentStateDataSourcePlugin()(structure as any)
    const code = generator(structure.chunks[0].content as types.Node).code
    return { code, flat: code.replace(/\s+/g, ' '), structure }
  }

  it('asks the route for the rows in the state’s own order and filter', async () => {
    const sortConfig = [{ field: 'name', direction: 'asc' }]
    const filterConfig = [
      { field: 'status', operator: 'equals', value: 'active' },
      { field: 'name', operator: 'equals', value: 'x', isDynamic: true },
    ]
    const { flat } = await run({
      pieces: boundState('array', [], [PUBLIC_TABLE], { sortConfig, filterConfig }),
    })

    expect(flat).toContain(
      `new URLSearchParams({ sorts: ${JSON.stringify(
        JSON.stringify(sortConfig)
      )}, filters: ${JSON.stringify(JSON.stringify([filterConfig[0]]))} })`
    )
  })

  it('reads states of one table with different orders separately', async () => {
    const { code } = await run({
      newest: boundState('array', [], [PUBLIC_TABLE], {
        sortConfig: [{ field: 'name', direction: 'desc' }],
      }),
      all: boundState('array', [], [PUBLIC_TABLE]),
    })

    expect(stateEffectsOf(code.replace(/^/gm, '  '))).toHaveLength(2)
  })

  it('asks in the visitor’s language in a project with languages, and again when it changes', async () => {
    const localized = await run(
      { pieces: boundState('array', [], [PUBLIC_TABLE]) },
      { internationalization: I18N }
    )

    expect(localized.flat).toContain('const router = useRouter();')
    expect(localized.flat).toContain(
      'if (router?.locale) { __query.set("locale", router?.locale); }'
    )
    expect(localized.flat).toContain('}, [router?.locale]);')
    expect(localized.structure.dependencies.useRouter).toMatchObject({ path: 'next/router' })

    const single = await run({ pieces: boundState('array', [], [PUBLIC_TABLE]) })
    expect(single.flat).not.toContain('router')
    expect(single.flat).toContain('}, []);')
  })

  it('keys a CSV file’s rows by column label, as the editor showed them', async () => {
    const { code } = await run({
      people: {
        type: 'array',
        defaultValue: [],
        dataSourceBinding: { dataSourceId: CSV_ID, refPath: ['data'] },
      },
    })
    const [effect] = stateEffectsOf(code.replace(/^/gm, '  '))
    const result = runEffect(effect.body, ['setPeople'], {
      success: true,
      data: [{ col_1: 'Ada' }],
    })
    await result.settle()

    expect(result.values.setPeople).toEqual([[{ Name: 'Ada' }]])
  })

  it('runs the state’s mapping function over what it read', async () => {
    const { code } = await run({
      names: boundState('array', [], [PUBLIC_TABLE], {
        mappingFunction: 'function mapData(items) { return items.map((item) => item.name) }',
      }),
    })
    const [effect] = stateEffectsOf(code.replace(/^/gm, '  '))
    const result = runEffect(effect.body, ['setNames'], {
      success: true,
      data: [{ name: 'Ada' }, { name: 'Grace' }],
    })
    await result.settle()

    expect(result.values.setNames).toEqual([['Ada', 'Grace']])
  })

  describe('for a state filled by an SQL statement', () => {
    const STATEMENT = `SELECT * FROM ${PUBLIC_TABLE} ORDER BY name LIMIT 3`
    const routesIn = (structure: { options: { extractedResources?: Record<string, any> } }) =>
      Object.keys(structure.options.extractedResources || {}).filter(
        (key) => key.indexOf('pages/api/component-state/') === 0
      )

    it('writes the route beside the table’s module and fetches it with nothing in the request', async () => {
      const { flat, structure } = await run({
        bestSellers: boundState('array', [], [PUBLIC_TABLE], { query: STATEMENT }),
      })
      const [key] = routesIn(structure)
      const route = structure.options.extractedResources[key]

      expect(routesIn(structure)).toHaveLength(1)
      expect(route.path).toEqual(['pages', 'api', 'component-state'])
      expect(key).toBe(`pages/api/component-state/${route.fileName}`)
      expect(route.fileName.indexOf(`showcase-${PUBLIC_TABLE}-`)).toBe(0)
      expect(route.content).toContain(`var STATEMENT = ${JSON.stringify(STATEMENT)}`)
      expect(route.content).toContain(
        `import dataSourceModule from '../../../utils/data-sources/${routeOf(PUBLIC_TABLE)}'`
      )
      expect(structure.options.extractedResources[`utils/${routeOf(PUBLIC_TABLE)}`]).toMatchObject({
        path: ['utils', 'data-sources'],
      })
      expect(flat).toContain(`fetch("/api/component-state/${route.fileName}")`)
      expect(flat).not.toContain('URLSearchParams')
      expect(flat).not.toContain('SELECT')
    })

    it('answers no browser when nothing decided who may open the component’s pages', async () => {
      const { structure } = await run({
        bestSellers: boundState('array', [], [PUBLIC_TABLE], { query: STATEMENT }),
      })
      const route = structure.options.extractedResources[routesIn(structure)[0]]

      expect(route.content).toContain('var COMPONENT_PAGES = []')
      expect(route.content).toContain('var READS_AS_STORE = false')
    })

    it('takes who may read from the pages that render the component', async () => {
      const { structure } = await run(
        { bestSellers: boundState('array', [], [PUBLIC_TABLE], { query: STATEMENT }) },
        {
          dataExposure: {
            tables: {},
            dataSources: {},
            components: {
              Showcase: {
                public: false,
                pages: [{ allowedRoles: ['staff'] }],
                readsAsStore: false,
              },
            },
          },
        }
      )
      const route = structure.options.extractedResources[routesIn(structure)[0]]

      expect(route.content).toContain(
        'var COMPONENT_PAGES = [{"allowedRoles":["staff"],"requiresSubscription":false,"subscriptionProductIds":[]}]'
      )
    })

    it('reads a table state and a statement state each from its own route', async () => {
      const { code, flat } = await run({
        pieces: boundState('array', [], [PUBLIC_TABLE]),
        bestSellers: boundState('array', [], [PUBLIC_TABLE], { query: STATEMENT }),
      })

      expect(stateEffectsOf(code.replace(/^/gm, '  '))).toHaveLength(2)
      expect(flat).toContain('setPieces(')
      expect(flat).toContain('setBestSellers(')
    })

    it('reads two states of one statement once, and two statements separately', async () => {
      const same = await run({
        bestSellers: boundState('array', [], [PUBLIC_TABLE], { query: STATEMENT }),
        best: boundState('object', {}, [PUBLIC_TABLE, 0], { query: STATEMENT }),
      })
      expect(routesIn(same.structure)).toHaveLength(1)
      expect(stateEffectsOf(same.code.replace(/^/gm, '  '))).toHaveLength(1)

      const different = await run({
        bestSellers: boundState('array', [], [PUBLIC_TABLE], { query: STATEMENT }),
        newest: boundState('array', [], [PUBLIC_TABLE], {
          query: `SELECT * FROM ${PUBLIC_TABLE} ORDER BY id DESC`,
        }),
      })
      expect(routesIn(different.structure)).toHaveLength(2)
    })

    it('asks once and in no language, in a project with languages too', async () => {
      const { flat, structure } = await run(
        { bestSellers: boundState('array', [], [PUBLIC_TABLE], { query: STATEMENT }) },
        { internationalization: I18N }
      )

      expect(flat).toContain('}, []);')
      expect(flat).not.toContain('router')
      expect(structure.dependencies.useRouter).toBeUndefined()
    })

    it('leaves to a workflow what the generated site cannot run for a component, and says which', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      const { flat, structure } = await run({
        mine: boundState('array', [], [PUBLIC_TABLE], {
          query: `SELECT * FROM ${PUBLIC_TABLE} WHERE user_id = '{{Current User.id}}'`,
        }),
        dropped: boundState('array', [], [PUBLIC_TABLE], { query: `DROP TABLE ${PUBLIC_TABLE}` }),
        people: {
          type: 'array',
          defaultValue: [],
          dataSourceBinding: { dataSourceId: CSV_ID, refPath: ['data'] },
          query: 'SELECT * FROM data',
        },
      })
      const said = warn.mock.calls.map((call) => String(call[0]))
      warn.mockRestore()

      expect(flat).toBe('const Showcase = props => { return null; };')
      expect(routesIn(structure)).toEqual([])
      const ours = said.filter((line) => /Component "Showcase":/.test(line))
      expect(ours).toHaveLength(1)
      for (const name of ['"mine"', '"dropped"', '"people"']) {
        expect(ours[0]).toContain(name)
      }
    })
  })

  it('changes nothing in a component with no bound state, or with no route to read', async () => {
    const plain = await run({ open: { type: 'boolean', defaultValue: false } })
    expect(plain.flat).toBe('const Showcase = props => { return null; };')
    expect(plain.structure.dependencies).toEqual({})

    const noRoute = await run(
      { pieces: boundState('array', [], [PUBLIC_TABLE]) },
      { extractedResources: undefined }
    )
    expect(noRoute.flat).toBe('const Showcase = props => { return null; };')
  })
})
