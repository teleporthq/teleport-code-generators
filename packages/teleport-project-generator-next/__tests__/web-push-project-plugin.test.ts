import { NextWebPushProjectPlugin } from '../src/web-push/project-plugin'
import { baseUidl, buildStructure, fileContent, workflowsUsing } from './_helpers/pwa-fixtures'

const run = async (extra: Record<string, unknown>) => {
  const structure = buildStructure(baseUidl(extra))
  await new NextWebPushProjectPlugin().runAfter(structure)
  return structure
}

describe('NextWebPushProjectPlugin', () => {
  it('ships the subscription store, both routes, the dependencies and the key environment', async () => {
    const structure = await run({
      webPush: { vapidPublicKey: 'BPublicKey' },
      workflows: workflowsUsing('browser-subscribe-to-push'),
    })

    expect(structure.files.get('web-push-server')?.path).toEqual(['utils', 'push'])
    expect(fileContent(structure, 'web-push-server', 'web-push-server')).toContain(
      'var TABLE = "teleport_push_subscriptions";'
    )
    expect(structure.files.get('web-push-subscriptions-route')?.path).toEqual([
      'pages',
      'api',
      'push',
    ])
    expect(fileContent(structure, 'web-push-subscriptions-route', 'subscriptions')).toContain(
      'require("../../../utils/push/web-push-server")'
    )
    expect(fileContent(structure, 'web-push-send-route', 'send')).toContain(
      'var TOKEN_HEADER = "x-teleport-push-token";'
    )
    expect(structure.dependencies).toEqual({ pg: '^8.12.0', 'web-push': '^3.6.7' })
    expect(structure.uidl.globals.env).toEqual({
      WEB_PUSH_VAPID_PUBLIC_KEY: 'BPublicKey',
      WEB_PUSH_VAPID_PRIVATE_KEY: '',
    })
  })

  it('keeps a private-key placeholder the editor already declared, and a dependency already pinned', async () => {
    const uidl = baseUidl({
      webPush: { vapidPublicKey: 'BPublicKey' },
      workflows: workflowsUsing('push-send-notification'),
    })
    uidl.globals.env = {
      WEB_PUSH_VAPID_PRIVATE_KEY: 'teleporthq.secrets.WEB_PUSH_VAPID_PRIVATE_KEY',
    }
    const structure = buildStructure(uidl)
    structure.dependencies.pg = '^8.11.0'

    await new NextWebPushProjectPlugin().runAfter(structure)

    expect(structure.uidl.globals.env?.WEB_PUSH_VAPID_PRIVATE_KEY).toBe(
      'teleporthq.secrets.WEB_PUSH_VAPID_PRIVATE_KEY'
    )
    expect(structure.dependencies.pg).toBe('^8.11.0')
  })

  it.each([
    ['push keys without any push node', { webPush: { vapidPublicKey: 'BPublicKey' } }],
    ['a push node without push keys', { workflows: workflowsUsing('browser-subscribe-to-push') }],
    [
      'only on-page notifications',
      {
        webPush: { vapidPublicKey: 'BPublicKey' },
        workflows: workflowsUsing('browser-show-notification'),
      },
    ],
  ])('emits nothing for %s', async (_label, extra) => {
    const structure = await run(extra)
    expect(structure.files.has('web-push-server')).toBe(false)
    expect(structure.files.has('web-push-subscriptions-route')).toBe(false)
    expect(structure.dependencies).toEqual({})
    expect(structure.uidl.globals.env).toBeUndefined()
  })
})
