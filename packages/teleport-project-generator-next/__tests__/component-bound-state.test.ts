/* tslint:disable:function-constructor no-any */
import generator from '@babel/generator'
import * as types from '@babel/types'
import { GeneratedFolder } from '@teleporthq/teleport-types'
import { generateSafeFileName } from '@teleporthq/teleport-plugin-next-data-source'
import {
  DATA_SOURCE_ID,
  bootReadRoute,
  buildDataExposureUidl,
  fileText,
} from './_helpers/data-exposure-fixture'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'
import { createComponentStateDataSourcePlugin } from '../src/state-data-source-plugin'

// A state bound to a table belongs to a page or to a COMPONENT. A page's is
// handed to it by its own server-side fetch. A component's was declared as
// `useState(props.<state> !== undefined ? props.<state> : <default>)` and then
// never given a value: no page fetched it and no instance passed it, so a list
// over it stayed empty on the generated site while the editor showed its rows.
// The component now reads the table itself, through the table's read route.

const PUBLIC_TABLE = 'studio_pieces'
const STAFF_ONLY_TABLE = 'staff_board'

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

const buildUidl = () => {
  const uidl = buildDataExposureUidl() as any
  const tables = uidl.dataSources[DATA_SOURCE_ID].config.selectedTables
  ;[PUBLIC_TABLE, STAFF_ONLY_TABLE].forEach((table) => {
    tables[table] = {
      name: table,
      columns: ['id', 'name', 'status'].map((name) => ({ name, type: 'text' })),
    }
  })

  uidl.components.Showcase = component('Showcase', {
    pieces: boundState('array', [], [PUBLIC_TABLE]),
    firstPiece: boundState('object', {}, [PUBLIC_TABLE, 0]),
    bestSellers: boundState('array', [], [PUBLIC_TABLE], {
      query: `SELECT * FROM ${PUBLIC_TABLE} ORDER BY name LIMIT 3`,
    }),
  })
  uidl.components.StaffBoard = component('StaffBoard', {
    notes: boundState('array', [], [STAFF_ONLY_TABLE]),
  })

  const pageNode = (value: string) =>
    uidl.root.node.content.children.find((child: any) => child.content.value === value).content.node
      .content.children
  // Every visitor may open the about page; only the staff role the staff page.
  pageNode('about').push(instanceOf('Showcase'))
  pageNode('staff').push(instanceOf('StaffBoard'))

  return uidl
}

const generate = async (): Promise<GeneratedFolder> => {
  const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder
  return createNextProjectGenerator().generateProject(buildUidl(), template)
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
    showcase = fileText(project, ['components'], 'showcase') || ''
  }, 120000)

  it('is read by the component itself, once, for every state of the same table', () => {
    const effects = stateEffectsOf(showcase)

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
    const run = runEffect(stateEffectsOf(showcase)[0].body, ['setPieces', 'setFirstPiece'], {
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
    const body = stateEffectsOf(showcase)[0].body
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
    const run = runEffect(stateEffectsOf(showcase)[0].body, ['setPieces', 'setFirstPiece'], {
      success: true,
      data: { unexpected: true },
    })
    await run.settle()

    expect(run.values.setPieces).toEqual([[]])
    expect(run.values.setFirstPiece).toEqual([{}])
  })

  it('reads through a route every visitor may call when a page every visitor opens shows it', async () => {
    const reply = await bootReadRoute(project, routeOf(PUBLIC_TABLE))({})

    expect(reply.status).toBe(200)
    expect(reply.body.success).toBe(true)
    expect(reply.body.data).toHaveLength(1)
    expect(reply.body.data[0]).not.toHaveProperty('password')
  })

  it('reads through a route only the page’s sessions may call when only a protected page shows it', async () => {
    const staffBoard = fileText(project, ['components'], 'staff-board') || ''
    expect(stateEffectsOf(staffBoard)).toHaveLength(1)

    const route = bootReadRoute(project, routeOf(STAFF_ONLY_TABLE))
    expect((await route({})).status).toBe(401)
    expect((await route({ session: { role: 'user' } })).status).toBe(403)
    expect((await route({ session: { role: 'staff' } })).status).toBe(200)
  })

  it('leaves a state with an SQL statement of its own to a workflow, and says so', () => {
    expect(showcase).not.toContain('setBestSellers(')
    expect(showcase).not.toContain('ORDER BY name LIMIT 3')
    expect(
      warnings.filter((warning) => /Component "Showcase": "bestSellers"/.test(warning))
    ).toHaveLength(1)
  })

  it('leaves the page that shows the component as it was: no fetch of its own for it', () => {
    const about = fileText(project, ['pages'], 'about') || ''

    expect(about).toContain('<Showcase>')
    expect(about).not.toContain('pieces')
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
