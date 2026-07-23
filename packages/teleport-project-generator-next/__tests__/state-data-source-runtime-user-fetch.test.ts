import generator from '@babel/generator'
import * as types from '@babel/types'
import { createStateDataSourcePlugin } from '../src/state-data-source-plugin'

// Regression guard for the "Characters page renders empty lists" defect
// (GuildForge run, examples/uidl-samples/project.json): page states bound to a
// data source with a `{{Current User.*}}` query were silently dropped — no
// getStaticProps fetch is possible (the placeholder only resolves at runtime)
// and nothing else populated them, so every list bound to such a state stayed
// empty forever. The plugin must instead emit an API route + a client-side
// useEffect fetch keyed on the signed-in user.

const DS_ID = '8e4bd2e9-1ceb-41ee-91ea-6f2aca94076e'

const USER_QUERY =
  "SELECT id, user_id, name FROM characters WHERE (user_id = '{{Current User.id}}' OR user_id IS NULL) ORDER BY name ASC LIMIT 20"

const makeState = (query?: string) => ({
  type: 'array',
  defaultValue: [] as unknown[],
  dataSourceBinding: {
    dataSourceId: DS_ID,
    refPath: ['characters'],
  },
  ...(query ? { query } : {}),
})

const makeJsxComponentChunk = () => ({
  type: 'AST',
  fileType: 'js',
  name: 'jsx-component',
  linkAfter: [] as string[],
  content: types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('Characters'),
      types.arrowFunctionExpression(
        [],
        types.blockStatement([types.returnStatement(types.nullLiteral())])
      )
    ),
  ]),
})

const makeStructure = (
  stateDefinitions: Record<string, unknown>,
  { auth = true, dynamicRouteAttribute }: { auth?: boolean; dynamicRouteAttribute?: string } = {}
) => ({
  uidl: {
    name: 'Characters',
    stateDefinitions,
    node: { type: 'element', content: { elementType: 'container' } },
    outputOptions: {
      folderPath: [] as string[],
      ...(dynamicRouteAttribute && { dynamicRouteAttribute }),
    },
  },
  chunks: [makeJsxComponentChunk()] as any[],
  dependencies: {} as Record<string, unknown>,
  options: {
    dataSources: {
      [DS_ID]: {
        id: DS_ID,
        type: 'teleport',
        config: {},
      },
    },
    extractedResources: {} as Record<string, unknown>,
    ...(auth ? { auth: { provider: 'teleport' } } : {}),
  },
})

const componentCode = (structure: { chunks: any[] }): string => {
  const chunk = structure.chunks.find((c) => c.name === 'jsx-component')
  return generator(chunk.content as types.Node).code
}

describe('state-data-source-plugin runtime {{Current User.*}} fetch', () => {
  const plugin = createStateDataSourcePlugin()

  it('emits an API route + useEffect fetch for a Current-User-bound state', async () => {
    const structure = makeStructure({ charactersResults: makeState(USER_QUERY) })

    const result = await plugin(structure as any)

    // API route extracted under pages/api/page-state with the parameterized query
    const resources = result.options.extractedResources as Record<
      string,
      { path: string[]; content: string }
    >
    const routeKeys = Object.keys(resources).filter((k) => k.startsWith('pages/api/page-state/'))
    expect(routeKeys).toHaveLength(1)
    const route = resources[routeKeys[0]]
    expect(route.path).toEqual(['pages', 'api', 'page-state'])
    expect(route.content).toContain('user_id = $1')
    expect(route.content).toContain('const { currentUserId } = req.query')
    expect(route.content).not.toContain('{{Current User.id}}')

    // Client-side effect wired to the signed-in user
    const code = componentCode(result as any)
    expect(code).toContain('const __pageStateCtx = useGlobalContext()')
    expect(code).toContain('useEffect(')
    expect(code).toContain('__pageStateCtx?.currentUser')
    expect(code).toContain('encodeURIComponent(__user?.id ?? "")')
    expect(code).toContain('setCharactersResults(Array.isArray(__data) ? __data : [])')
    expect(code).toContain('/api/page-state/')

    // Hook + context imports registered
    expect(result.dependencies.useEffect).toBeDefined()
    expect(result.dependencies.useGlobalContext).toBeDefined()

    // No getStaticProps fetch was emitted for the runtime state
    const gsp = result.chunks.find((c: any) => c.name === 'getStaticProps')
    if (gsp) {
      expect(generator(gsp.content as types.Node).code).not.toContain('charactersResults')
    }
  })

  it('shares one fetch effect between states with identical queries and keeps distinct queries apart', async () => {
    const structure = makeStructure({
      charactersResults: makeState(USER_QUERY),
      mirror: makeState(USER_QUERY),
      mainSpotlight: makeState(
        "SELECT id FROM characters WHERE user_id = '{{Current User.id}}' AND is_main = TRUE LIMIT 1"
      ),
    })

    const result = await plugin(structure as any)

    const routeKeys = Object.keys(result.options.extractedResources as object).filter((k) =>
      k.startsWith('pages/api/page-state/')
    )
    expect(routeKeys).toHaveLength(2)

    const code = componentCode(result as any)
    // Shared group: both setters inside the same effect
    expect(code).toContain('setCharactersResults(')
    expect(code).toContain('setMirror(')
    expect(code).toContain('setMainSpotlight(')
    expect(code.match(/useEffect\(/g)).toHaveLength(2)
  })

  it('does nothing for such states when the project has no authentication', async () => {
    const structure = makeStructure({ charactersResults: makeState(USER_QUERY) }, { auth: false })

    const result = await plugin(structure as any)

    expect(Object.keys(result.options.extractedResources as object)).toHaveLength(0)
    const code = componentCode(result as any)
    expect(code).not.toContain('useEffect(')
    expect(result.dependencies.useEffect).toBeUndefined()
  })

  it('still skips queries with placeholders other than {{Current User.*}}', async () => {
    const structure = makeStructure({
      detailRows: makeState("SELECT * FROM events WHERE id = '{{Current Page Entity.id}}'"),
    })

    const result = await plugin(structure as any)

    expect(Object.keys(result.options.extractedResources as object)).toHaveLength(0)
    expect(componentCode(result as any)).not.toContain('useEffect(')
  })

  it('emits a route-param-driven fetch for a {{Current Page Entity.id}} query on a details page', async () => {
    // GuildForge guild-details regression: guildMemberships was bound to an
    // entity-scoped query; the binding was silently dropped so the members
    // list stayed empty in the generated app while the GUI editor (which
    // resolves the binding itself) showed it populated.
    const entityQuery =
      'SELECT m.id, u.name FROM memberships m LEFT JOIN users u ON m.user_id = u.id ' +
      "WHERE m.guild_id = '{{Current Page Entity.id}}' ORDER BY u.name ASC"
    const structure = makeStructure(
      {
        guildMemberships: {
          ...makeState(entityQuery),
          dataSourceBinding: { dataSourceId: DS_ID, refPath: [] },
        },
      },
      { dynamicRouteAttribute: 'id' }
    )

    const result = await plugin(structure as any)

    const resources = result.options.extractedResources as Record<string, { content: string }>
    const routeKeys = Object.keys(resources).filter((k) => k.startsWith('pages/api/page-state/'))
    expect(routeKeys).toHaveLength(1)
    expect(resources[routeKeys[0]].content).toContain('m.guild_id = $1')
    expect(resources[routeKeys[0]].content).toContain('const { currentPageEntityId } = req.query')

    const code = componentCode(result as any)
    expect(code).toContain('const __pageStateRouter = useRouter()')
    expect(code).toContain('__pageStateRouter.query?.["id"]')
    expect(code).toContain('encodeURIComponent(__entityId)')
    expect(code).toContain('setGuildMemberships(Array.isArray(__data) ? __data : [])')
    // Entity-only query must not require auth context
    expect(code).not.toContain('__pageStateCtx')
    expect(result.dependencies.useRouter).toBeDefined()
    expect(result.dependencies.useGlobalContext).toBeUndefined()
  })

  it('works without authentication when the query only uses {{Current Page Entity.id}}', async () => {
    const entityQuery = "SELECT * FROM memberships WHERE guild_id = '{{Current Page Entity.id}}'"
    const structure = makeStructure(
      { members: makeState(entityQuery) },
      { auth: false, dynamicRouteAttribute: 'id' }
    )

    const result = await plugin(structure as any)
    expect(
      Object.keys(result.options.extractedResources as object).filter((k) =>
        k.startsWith('pages/api/page-state/')
      )
    ).toHaveLength(1)
    expect(componentCode(result as any)).toContain('useEffect(')
  })

  it('skips a {{Current Page Entity.id}} query on a non-details page (no route param)', async () => {
    const entityQuery = "SELECT * FROM memberships WHERE guild_id = '{{Current Page Entity.id}}'"
    const structure = makeStructure({ members: makeState(entityQuery) })

    const result = await plugin(structure as any)
    expect(Object.keys(result.options.extractedResources as object)).toHaveLength(0)
    expect(componentCode(result as any)).not.toContain('useEffect(')
  })

  it('combines user and entity tokens in one fetch with both guards', async () => {
    const mixedQuery =
      "SELECT * FROM memberships WHERE guild_id = '{{Current Page Entity.id}}' " +
      "AND user_id = '{{Current User.id}}'"
    const structure = makeStructure(
      { myMembership: makeState(mixedQuery) },
      { dynamicRouteAttribute: 'id' }
    )

    const result = await plugin(structure as any)

    const resources = result.options.extractedResources as Record<string, { content: string }>
    const routeKey = Object.keys(resources).find((k) => k.startsWith('pages/api/page-state/'))!
    expect(resources[routeKey].content).toContain('guild_id = $1')
    expect(resources[routeKey].content).toContain('user_id = $2')
    expect(resources[routeKey].content).toContain('currentPageEntityId, currentUserId')

    const code = componentCode(result as any)
    expect(code).toContain('const __pageStateCtx = useGlobalContext()')
    expect(code).toContain('const __pageStateRouter = useRouter()')
    expect(code).toContain('if (!__user) return')
    expect(code).toContain('if (!__entityId) return')
  })

  it('keeps build-time states in getStaticProps while runtime states get effects', async () => {
    const structure = makeStructure({
      allGuilds: makeState('SELECT * FROM guilds ORDER BY name ASC'),
      myCharacters: makeState(USER_QUERY),
    })

    const result = await plugin(structure as any)

    const gsp = result.chunks.find((c: any) => c.name === 'getStaticProps')
    expect(gsp).toBeDefined()
    const gspCode = generator(gsp.content as types.Node).code
    expect(gspCode).toContain('allGuilds')
    expect(gspCode).not.toContain('myCharacters')

    const code = componentCode(result as any)
    expect(code).toContain('setMyCharacters(')
    expect(code).not.toContain('setAllGuilds(')
  })
})
