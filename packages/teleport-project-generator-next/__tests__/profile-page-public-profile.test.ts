/* tslint:disable:function-constructor max-classes-per-file no-any */
import { parse } from '@babel/parser'
import generate from '@babel/generator'
import * as types from '@babel/types'
import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import profileFixture from './__fixtures__/profile-page-uidl.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

/**
 * `/profile/[id]`, the store template's member profile, as the editor exports
 * it (`__fixtures__/profile-page-uidl.json`): an owner section — "My Profile",
 * the account form, the email from the member's own session — shown when the
 * page's member is the signed-in one (`props.user?.id === currentUser?.['id']`),
 * and a viewer section — avatar, name, email — for everyone else.
 *
 * Its page data was the member's whole account read as the store: any signed-in
 * member opening `/profile/<id>` received another member's email, phone,
 * addresses and role. Read as a visitor it got nothing, and both sections came
 * out empty. It now carries the member's public profile only — id, name,
 * avatar — which is all either section takes from it.
 */

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder
const fixture = profileFixture as any

const MEMBERS = [
  {
    id: 'u1',
    name: 'Ana',
    email: 'ana@example.com',
    phone: '+40 711 111 111',
    details: { address: '1 Main St' },
    role: 'user',
    password: 'hash-ana',
    access_token: 'token-ana',
    image: 'https://cdn.example.com/ana.png',
  },
  {
    id: 'u2',
    name: 'Bo',
    email: 'bo@example.com',
    phone: '+40 722 222 222',
    details: { address: '2 Side St' },
    role: 'user',
    password: 'hash-bo',
    access_token: 'token-bo',
    image: 'https://cdn.example.com/bo.png',
  },
]
const PRIVATE_OF_BO = ['bo@example.com', '+40 722', '2 Side St', 'hash-bo', 'token-bo', '"role"']

const buildProfileUidl = (): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as any
  uidl.dataSources = { [fixture.dataSource.id]: fixture.dataSource }
  uidl.resources = { items: JSON.parse(JSON.stringify(fixture.resources)), resourceMappers: {} }
  uidl.workflows = { workflows: fixture.workflows, customNodes: fixture.customNodes }
  uidl.globalStateDefinitions = fixture.globalStateDefinitions
  uidl.authentication = fixture.authentication
  uidl.root.designLanguage = fixture.designLanguage
  uidl.root.styleSetDefinitions = {
    ...(uidl.root.styleSetDefinitions || {}),
    ...fixture.styleSetDefinitions,
  }
  uidl.root.stateDefinitions.route.values.push(JSON.parse(JSON.stringify(fixture.route)))
  uidl.root.node.content.children.push(JSON.parse(JSON.stringify(fixture.pageNode)))
  return uidl
}

const findFile = (folder: GeneratedFolder, path: string[]): string => {
  let current: GeneratedFolder | undefined = folder
  for (const segment of path.slice(0, -1)) {
    current = current?.subFolders.find((sub) => sub.name === segment)
  }
  const file = current?.files.find((entry) => entry.name === path[path.length - 1])
  if (!file) {
    throw new Error(`not generated: ${path.join('/')}`)
  }
  return String(file.content)
}

const findFileNamed = (folder: GeneratedFolder, pattern: RegExp): string => {
  const file = folder.files.find((entry) => pattern.test(entry.name))
  if (file) {
    return String(file.content)
  }
  for (const sub of folder.subFolders) {
    const found = findFileNamed(sub, pattern)
    if (found) {
      return found
    }
  }
  return ''
}

/** The users route, over a database holding MEMBERS. */
const bootUsersModule = (code: string): any => {
  const commonJs = code
    .replace(
      "import { Client, types as pgTypes } from 'pg'",
      "const { Client, types: pgTypes } = require('pg')"
    )
    .replace(/^export \{[^}]*\}\s*$/m, '')
    .replace(/^export default \{[^}]*\}\s*$/m, '')
    .concat('\nmodule.exports = { fetchData, fetchCount, handler, getCount }')
  expect(commonJs).not.toMatch(/^(import|export) /m)
  class FakeClient {
    public async connect(): Promise<void> {
      return
    }
    public async end(): Promise<void> {
      return
    }
    public async query(sql: string, params: unknown[] = []): Promise<any> {
      const rows = /WHERE id = \$1/.test(sql)
        ? MEMBERS.filter((member) => member.id === params[0])
        : MEMBERS
      return { rows, rowCount: rows.length }
    }
  }
  const fakeRequire = (name: string): any => {
    if (name === 'pg') {
      return { Client: FakeClient }
    }
    if (name === 'next-auth/jwt') {
      return { getToken: async () => null }
    }
    throw new Error('unexpected require: ' + name)
  }
  const moduleObj: { exports: any } = { exports: {} }
  new Function('require', 'module', 'exports', 'process', 'console', commonJs)(
    fakeRequire,
    moduleObj,
    moduleObj.exports,
    { env: { NEXTAUTH_SECRET: 'secret' } },
    { error: () => undefined, warn: () => undefined, log: () => undefined }
  )
  return moduleObj.exports
}

const topLevelFunction = (code: string, name: string): string => {
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] })
  for (const statement of ast.program.body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    if (declaration?.type === 'FunctionDeclaration' && declaration.id?.name === name) {
      return generate(declaration as types.Node).code
    }
  }
  throw new Error(`no function ${name}`)
}

/** Every expression of the page whose source matches, in the page's own spelling. */
const pageExpressions = (code: string, test: (source: string) => boolean): string[] => {
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] })
  const found: string[] = []
  types.traverseFast(ast, (node) => {
    if (node.type === 'JSXExpressionContainer' && node.expression.type !== 'JSXEmptyExpression') {
      const source = generate(node.expression as types.Node).code
      if (test(source)) {
        found.push(source)
      }
    }
  })
  return found
}

describe('/profile/[id]: a member’s public profile, never their account', () => {
  let page: string
  let pageData: (params: { id: string }) => Promise<any>

  beforeAll(async () => {
    const folder = await createNextProjectGenerator().generateProject(buildProfileUidl(), template)
    page = findFile(folder, ['pages', 'profile', '[id]'])
    const resourceCode = findFileNamed(folder, /^fetch_users_detail/)
    const usersModule = bootUsersModule(findFileNamed(folder, /^teleport-users-/))

    // The resource the page imports, over that module.
    const resource = new Function(
      'dataSourceModule',
      resourceCode
        .replace(/^import .*$/gm, '')
        .replace('export default async function', 'return async function')
    )(usersModule)
    const getServerSideProps = new Function(
      'fetchUsersDetailResource',
      `${topLevelFunction(page, 'getServerSideProps')}\nreturn getServerSideProps`
    )(resource)
    pageData = (params) => getServerSideProps({ params })
  }, 120000)

  it("carries another member's name and avatar, and nothing private", async () => {
    const data = await pageData({ id: 'u2' })

    expect(data.props.user).toEqual({
      id: 'u2',
      name: 'Bo',
      image: 'https://cdn.example.com/bo.png',
    })
    PRIVATE_OF_BO.forEach((value) => expect(JSON.stringify(data)).not.toContain(value))

    // The viewer section shows them; its email line has nothing to show.
    const viewer = pageExpressions(page, (source) =>
      /props\??\.user\?\.(image|name|email)$/.test(source)
    )
    const shown = viewer.map((source) => new Function('props', `return ${source}`)(data.props))
    expect(shown).toEqual(
      expect.arrayContaining(['https://cdn.example.com/bo.png', 'Bo', undefined])
    )
  })

  it('fills the owner’s own section and form: the profile from the page, the email from their session', async () => {
    const data = await pageData({ id: 'u2' })
    // What the runtime holds of the signed-in member: their own session
    // (global-context `pickUser` over /api/auth/session).
    const currentUser = {
      id: 'u2',
      name: 'Bo',
      email: 'bo@example.com',
      emailVerified: null,
      image: 'https://cdn.example.com/bo.png',
      role: 'user',
    }

    const [gate] = pageExpressions(page, (source) =>
      source.startsWith("props.user?.id === currentUser?.['id']")
    )
    expect(
      new Function('props', 'currentUser', `return ${gate.split(' && ')[0]}`)(
        data.props,
        currentUser
      )
    ).toBe(true)

    const normalize = new Function(
      `${topLevelFunction(page, '__normalizeAdminFormRow')}\nreturn __normalizeAdminFormRow`
    )()
    const seeded = page.match(/__normalizeAdminFormRow\(props\.user, (\{[^}]*\})\)/)
    expect(seeded).not.toBeNull()
    const defaults = new Function(`return ${seeded![1]}`)()
    expect(normalize(data.props.user, defaults)).toMatchObject({
      name: 'Bo',
      image: 'https://cdn.example.com/bo.png',
    })

    expect(page).toContain("value={currentUser?.['email']}")
    expect(new Function('currentUser', "return currentUser?.['email']")(currentUser)).toBe(
      'bo@example.com'
    )
  })

  it('shows a guest nothing private, behind the sign-in the page requires', async () => {
    // The page is members-only (`/profile` in the middleware's protected
    // routes); and whoever reaches its data gets the public profile alone.
    const data = await pageData({ id: 'u1' })
    expect(data.props.user).toEqual({
      id: 'u1',
      name: 'Ana',
      image: 'https://cdn.example.com/ana.png',
    })
    expect(JSON.stringify(data)).not.toMatch(
      /ana@example\.com|\+40 711|1 Main St|hash-ana|token-ana/
    )
    expect(fixture.authentication.pageProtection[fixture.route.pageId]).toMatchObject({
      requiresAuth: true,
      route: '/profile',
    })
  })
})
