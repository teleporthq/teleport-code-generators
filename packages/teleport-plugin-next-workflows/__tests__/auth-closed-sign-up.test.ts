import { UIDLAuthentication } from '@teleporthq/teleport-types'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'

/**
 * `/api/auth/signup` creates a `user` account for whoever posts to it. An
 * internal tool that owns its project has no public sign-up — an admin adds
 * every account from the admin panel's Users screen — so its app must not
 * carry the route (`closedSignUp`). Every other project keeps it.
 */

const auth = (extra: Partial<UIDLAuthentication> = {}): UIDLAuthentication => ({
  enabled: true,
  dataSourceId: 'ds-1',
  dataSourceType: 'teleport',
  passwordAuthEnabled: true,
  providers: [],
  roles: ['admin', 'staff', 'user'],
  tables: {},
  pageProtection: {},
  folderProtection: {},
  authPages: {
    signIn: { pageId: 'p-sign-in', pageName: 'sign-in', route: '/auth/sign-in' },
  },
  callbackBaseUrl: '/api/auth/callback',
  envKeys: {},
  customUserProperties: [],
  ...extra,
})

const emittedFiles = async (authentication: UIDLAuthentication): Promise<Set<string>> => {
  const structure: any = {
    uidl: {
      name: 'Tool',
      globals: { settings: { title: 'Tool' } },
      root: { name: 'Root', stateDefinitions: {}, node: { type: 'element', content: {} } },
      dataSources: { 'ds-1': { type: 'teleport', config: {} } },
      authentication,
    },
    strategy: { pages: { options: {} } },
    files: new Map(),
    dependencies: {},
    devDependencies: {},
  }
  await new NextWorkflowProjectPlugin().runAfter(structure)
  return new Set(structure.files.keys())
}

describe('the public sign-up route', () => {
  it('is not emitted when sign-up is closed', async () => {
    const files = await emittedFiles(auth({ closedSignUp: true } as Partial<UIDLAuthentication>))
    expect(files.has('auth-signup-route')).toBe(false)
    // Signing in is untouched.
    expect(files.has('auth-nextauth-route')).toBe(true)
    expect(files.has('auth-hash-password')).toBe(true)
  })

  it('stays for every other project', async () => {
    expect((await emittedFiles(auth())).has('auth-signup-route')).toBe(true)
    const signUp = { pageId: 'p-sign-up', pageName: 'sign-up', route: '/auth/sign-up' }
    // A sign-up page the visitor can still open wins over a stale flag.
    const reopened = auth({
      closedSignUp: true,
      authPages: { ...auth().authPages, signUp },
    } as Partial<UIDLAuthentication>)
    expect((await emittedFiles(reopened)).has('auth-signup-route')).toBe(true)
  })
})
