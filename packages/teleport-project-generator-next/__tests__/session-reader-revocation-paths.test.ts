import { posix } from 'path'
import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { SessionCookieResolver } from '@teleporthq/teleport-shared'
import { NextWorkflowProjectPlugin } from '../../teleport-plugin-next-workflows/src/workflow-project-plugin'
import { NextDataSourceUtilityPlugin } from '../src/data-source-utility-plugin'
import { NextEcommerceProjectPlugin } from '../src/ecommerce/project-plugin'
import { NextGlobalStateProjectPlugin } from '../src/global-state/project-plugin'
import { NextAIChatProjectPlugin } from '../src/ai-chat/project-plugin'
import { NextWebPushProjectPlugin } from '../src/web-push/project-plugin'
import { buildAIChatProjectUidl } from './_helpers/ai-chat-project-uidl'

/**
 * Final review I2 / review fix A9: the session-stamp check lives in the one
 * session reader, `__tqSessionToken`, which every generated server file
 * inlines. The reader requires the check from the project root, so each file
 * must name the path from ITS folder: a wrong depth would silently drop the
 * check (or, fail-closed, refuse every signed-in visitor). The files and their
 * folders are the ones the project plugins really emit (their file maps), not
 * a list kept by hand.
 *
 * A6: a project without authentication emits the reader exactly as before the
 * check existed — no revocation require anywhere.
 */

const PG = {
  id: 'ds-1',
  name: 'db',
  type: 'postgresql',
  config: { host: 'h', port: 5432, user: 'u', password: 'p', database: 'd' },
}

const node = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config,
})

const projectUidl = (withAuth: boolean) => {
  const uidl = buildAIChatProjectUidl(false) as any
  uidl.aiAssistantChat.authProtection = { requiresAuth: true, allowedRoles: [] }
  uidl.aiAssistantChat.dataSourceId = 'ds-1'
  uidl.dataSources = { 'ds-1': PG }
  uidl.resources = {
    items: {
      products: {
        name: 'products',
        path: { baseUrl: { type: 'static', content: '/api/postgresql-products-ds-1' }, route: {} },
        params: {
          dataSourceId: { type: 'static', content: 'ds-1' },
          dataSourceType: { type: 'static', content: 'postgresql' },
          tableName: { type: 'static', content: 'products' },
        },
      },
    },
  }
  uidl.globalStateDefinitions = {
    catalog: {
      name: 'catalog',
      type: 'array',
      defaultValue: [],
      dataSourceBinding: { dataSourceId: 'ds-1', refPath: ['products'] },
    },
    favourites: {
      name: 'favourites',
      type: 'array',
      defaultValue: [],
      dataSourceBinding: { dataSourceId: 'ds-1', refPath: ['teleport_favourites'] },
      query: 'SELECT * FROM teleport_favourites',
    },
  }
  uidl.workflows = {
    workflows: {
      everything: {
        id: 'everything',
        name: 'Everything',
        trigger: { type: 'event-element-clicked', nodeId: 'el', config: {} },
        nodes: [
          node('n1', 'data-select', { dataSourceId: 'ds-1', tableName: 'products' }),
          node('n2', 'realtime-join-channel', { channel: 'room' }),
          node('n3', 'file-storage-upload', {}),
          node('n4', 'browser-subscribe-to-push', {}),
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3' },
          { id: 'e3', source: 'n3', target: 'n4' },
        ],
      },
    },
    customNodes: {},
  }
  uidl.webPush = { vapidPublicKey: 'BPublicKey' }
  uidl.ecommerceSettings = {
    dataSourceId: 'ds-1',
    currency: 'USD',
    categories: [],
    digitalProducts: { enabled: true },
  }
  uidl.invoiceSettings = { enabled: true, dataSourceId: 'ds-1', companyDetails: {} }
  if (withAuth) {
    // A route only signed-in visitors may run, and the account deletion.
    uidl.workflows.workflows.everything.protection = { requiresAuth: true, allowedRoles: [] }
    uidl.workflows.workflows.leave = {
      id: 'leave',
      name: 'Delete My Account',
      trigger: { type: 'event-element-clicked', nodeId: 'el-2', config: {} },
      nodes: [node('d1', 'account-delete-current', {})],
      edges: [],
    }
    uidl.authentication = {
      enabled: true,
      dataSourceId: 'ds-1',
      dataSourceType: 'postgresql',
      passwordAuthEnabled: true,
      providers: [],
      roles: ['user', 'admin'],
      tables: {},
      pageProtection: {
        premium: { requiresAuth: true, allowedRoles: [], requiresSubscription: true },
      },
      folderProtection: {},
      authPages: {},
      callbackBaseUrl: '/api/auth/callback',
      envKeys: {},
      customUserProperties: [],
    }
  }
  return uidl
}

const PLUGINS = (): ProjectPlugin[] => [
  new NextDataSourceUtilityPlugin(),
  new NextWorkflowProjectPlugin(),
  new NextEcommerceProjectPlugin(),
  new NextGlobalStateProjectPlugin(),
  new NextAIChatProjectPlugin(),
  new NextWebPushProjectPlugin(),
]

/** Every file the plugins emit, at the path it is written to. */
const emittedFiles = async (withAuth: boolean): Promise<Map<string, string>> => {
  const structure = {
    uidl: projectUidl(withAuth),
    files: new Map(),
    dependencies: {},
    devDependencies: {},
    strategy: { pages: { options: {} } },
  } as unknown as ProjectPluginStructure
  for (const plugin of PLUGINS()) {
    await plugin.runBefore(structure)
  }
  for (const plugin of PLUGINS()) {
    await plugin.runAfter(structure)
  }
  const emitted = new Map<string, string>()
  for (const record of structure.files.values()) {
    for (const file of record.files || []) {
      if (typeof file.content !== 'string') {
        continue
      }
      const name = file.fileType ? `${file.name}.${file.fileType}` : file.name
      emitted.set(posix.join(...(record.path || []), name), file.content)
    }
  }
  return emitted
}

const READER = 'function __tqSessionToken(req)'
const REVOCATION_REQUIRE = /require\('([^']*utils\/auth\/session-revocation)'\)/g

describe('every server file reads the session through the one revocation-aware reader', () => {
  let files: Map<string, string>
  beforeAll(async () => {
    files = await emittedFiles(true)
  })

  it('requires the check from its own folder, in every file that reads a session', () => {
    expect(files.has('utils/auth/session-revocation.js')).toBe(true)
    const readers = Array.from(files.entries()).filter(([, code]) => code.includes(READER))
    for (const [file, code] of readers) {
      expect(code).toContain('.then(__tqLiveSession)')
      const specifiers = Array.from(code.matchAll(REVOCATION_REQUIRE), (match) => match[1])
      expect(specifiers.length).toBeGreaterThan(0)
      for (const specifier of specifiers) {
        expect([file, posix.join(posix.dirname(file), specifier)]).toEqual([
          file,
          'utils/auth/session-revocation',
        ])
      }
      expect(code).not.toContain('getServerSession')
    }
    // The emitters of a project with each feature: the account deletion, the
    // data API, the guards, realtime, uploads, invoices, the cart, downloads,
    // push, the chat and the data-source reads.
    const readerFiles = readers.map(([file]) => file)
    for (const expected of [
      /^pages\/api\/account\//,
      /^pages\/api\/data\//,
      /^pages\/api\/auth\/subscriber-access\.js$/,
      /^utils\/auth\/page-access\.js$/,
      /^utils\/workflows\/workflow-auth\.js$/,
      /^utils\/workflows\/server-runtime\.js$/,
      /^utils\/realtime\//,
      /^pages\/api\/runtime-storage\//,
      /^pages\/api\/invoices\//,
      /^pages\/api\/cart\//,
      /^pages\/api\/downloads\//,
      /^pages\/api\/push\//,
      /^pages\/api\/ai-chat\//,
      /^utils\/data-sources\//,
      /^pages\/api\/global-state\//,
    ]) {
      expect([expected.source, readerFiles.some((file) => expected.test(file))]).toEqual([
        expected.source,
        true,
      ])
    }
  })

  it('A6: a project without authentication emits no revocation require, and the reader without the check', async () => {
    const noAuth = await emittedFiles(false)
    const readers = Array.from(noAuth.entries()).filter(([, code]) => code.includes(READER))
    expect(readers.length).toBeGreaterThan(0)
    const readerFiles = readers.map(([file]) => file)
    for (const expected of [
      /^pages\/api\/cart\//,
      /^pages\/api\/downloads\//,
      /^pages\/api\/push\//,
      /^utils\/realtime\//,
      /^pages\/api\/runtime-storage\//,
      /^utils\/data-sources\//,
      /^pages\/api\/global-state\//,
      /^pages\/api\/ai-chat\//,
    ]) {
      expect([expected.source, readerFiles.some((file) => expected.test(file))]).toEqual([
        expected.source,
        true,
      ])
    }
    const withoutCheck = SessionCookieResolver.generateCommonJsSessionTokenResolverCode('../..', {
      withRevocation: false,
    })
    for (const [file, code] of noAuth) {
      expect([file, Array.from(code.matchAll(REVOCATION_REQUIRE)).length]).toEqual([file, 0])
      expect([file, code.includes('__tqLiveSession')]).toEqual([file, false])
    }
    // The reader each one inlines is the one without the check, word for word.
    for (const [file, code] of readers) {
      expect([file, code.includes(withoutCheck)]).toEqual([file, true])
    }
    expect(withoutCheck).not.toContain('__tqLiveSession')
    expect(noAuth.has('utils/auth/session-revocation.js')).toBe(false)
  })
})
