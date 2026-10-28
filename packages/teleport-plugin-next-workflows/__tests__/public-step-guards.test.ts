import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import adminFileWorkflows from './fixtures/admin-file-workflows.json'
import {
  PUBLIC_STEP_REFUSAL_CODE,
  PublicStepRefusalError,
  findPublicRestrictedSteps,
} from '../src/public-step-guards'

// A push to every subscriber and the stored-file steps (delete, list, details)
// act for the whole site. On a route any visitor can call they are a broadcast
// and a file wiper anyone can replay, so generation refuses them there — with a
// sentence the editor shows the person publishing.

const node = (id: string, type: string, name?: string) => ({
  id,
  type,
  label: type,
  ...(name ? { name } : {}),
  config: {},
})

const pageWorkflow = (nodes: unknown[], extra: Record<string, unknown> = {}) => ({
  name: 'Notify Everyone',
  trigger: { type: 'event-element-clicked' },
  nodes,
  edges: [] as unknown[],
  ...extra,
})

const ADMIN = { requiresAuth: true, allowedRoles: ['admin'], derivedFrom: 'page' }

const structure = (workflows: unknown): any => ({
  uidl: {
    name: 'Site',
    globals: { settings: { title: 'Site' } },
    root: { name: 'Root', stateDefinitions: {}, node: { type: 'element', content: {} } },
    workflows,
  },
  strategy: { pages: { options: {} } },
  files: new Map(),
  dependencies: {},
  devDependencies: {},
})

/** The sentence the editor shows: the `message` of the JSON body in the error's text. */
const shownSentence = (error: Error): string => {
  const text = String(error)
  const body = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  expect(body.code).toBe(PUBLIC_STEP_REFUSAL_CODE)
  return body.message
}

describe('restricted steps on a public route', () => {
  it.each([
    'push-send-notification',
    'file-storage-delete',
    'file-storage-list',
    'file-storage-get-details',
  ])('refuses %s in a workflow any visitor can start', (type) => {
    const refusals = findPublicRestrictedSteps({
      workflows: { w1: pageWorkflow([node('n1', type)]) },
    })
    expect(refusals).toEqual([
      expect.objectContaining({
        ownerId: 'w1',
        nodeId: 'n1',
        nodeType: type,
        ownerKind: 'workflow',
      }),
    ])
  })

  it('refuses one that only binds the user (userScoped) — a guest still reaches it', () => {
    const protection = {
      requiresAuth: false,
      allowedRoles: [] as string[],
      userScoped: { ownerColumn: 'user_id', bindings: [] as unknown[] },
      derivedFrom: 'graph',
    }
    expect(
      findPublicRestrictedSteps({
        workflows: { w1: pageWorkflow([node('n1', 'file-storage-delete')], { protection }) },
      })
    ).toHaveLength(1)
  })

  it('refuses a webhook that checks no signature, and a custom node without a policy', () => {
    const refusals = findPublicRestrictedSteps({
      workflows: {
        hook: pageWorkflow([node('p', 'push-send-notification')], {
          trigger: { type: 'event-webhook-received' },
          webhookConfig: { urlPath: 'notify', verifySignature: false },
        }),
      },
      customNodes: { cn: { name: 'Wipe', nodes: [node('d', 'file-storage-delete')] } },
    })
    expect(refusals.map((r) => `${r.ownerKind}:${r.nodeId}`)).toEqual([
      'workflow:p',
      'custom-node:d',
    ])
  })

  it('refuses push, delete and list for any signed-in user, or a role that is not staff', () => {
    const anyUser = { requiresAuth: true, allowedRoles: [] as string[], derivedFrom: 'page' }
    const member = { requiresAuth: true, allowedRoles: ['member'], derivedFrom: 'page' }
    const mixed = { requiresAuth: true, allowedRoles: ['admin', 'user'], derivedFrom: 'page' }
    const refusals = findPublicRestrictedSteps({
      workflows: {
        anyUser: pageWorkflow([node('a', 'push-send-notification')], { protection: anyUser }),
        member: pageWorkflow([node('b', 'file-storage-delete')], { protection: member }),
        mixed: pageWorkflow([node('c', 'file-storage-list')], { protection: mixed }),
        // Reading one file's details needs a session only.
        details: pageWorkflow([node('d', 'file-storage-get-details')], { protection: anyUser }),
      },
    })
    expect(refusals.map((r) => r.nodeId)).toEqual(['a', 'b', 'c'])
  })

  it('names the roles that can start it today and the ones that would be admins', () => {
    const member = { requiresAuth: true, allowedRoles: ['member', 'user'], derivedFrom: 'page' }
    const anyUser = { requiresAuth: true, allowedRoles: [] as string[], derivedFrom: 'page' }
    const sentenceFor = (protection: unknown) =>
      shownSentence(
        new PublicStepRefusalError(
          findPublicRestrictedSteps(
            {
              workflows: { w1: pageWorkflow([node('n1', 'file-storage-delete')], { protection }) },
            },
            { staffRoles: ['admin', 'manager'] }
          ),
          ['admin', 'manager']
        )
      )
    const forMembers = sentenceFor(member)
    expect(forMembers).toContain('which anyone with the role "member" or "user" can start')
    expect(forMembers).toContain('let only the role "admin" or "manager" start it')
    expect(forMembers.length).toBeLessThanOrEqual(400)
    expect(sentenceFor(anyUser)).toContain('which anyone signed in can start')
  })

  it('allows them behind a named staff role: admin, and the project’s admin-panel roles', () => {
    const manager = { requiresAuth: true, allowedRoles: ['manager'], derivedFrom: 'page' }
    const workflows = {
      workflows: {
        manager: pageWorkflow([node('a', 'file-storage-delete')], { protection: manager }),
      },
    }
    expect(findPublicRestrictedSteps(workflows)).toHaveLength(1)
    expect(findPublicRestrictedSteps(workflows, { staffRoles: ['admin', 'manager'] })).toEqual([])
  })

  it('refuses a server-only custom node that a public workflow calls (its segment runs it)', () => {
    const serverOnly = { requiresAuth: false, allowedRoles: [] as string[], serverOnly: true }
    const call = (id: string, customNodeId: string) => ({
      ...node(id, 'general-custom-node'),
      config: { customNodeId },
    })
    const refusals = findPublicRestrictedSteps({
      workflows: {
        page: pageWorkflow([call('call', 'notify')]),
        admin: pageWorkflow([call('call2', 'clean')], { protection: ADMIN }),
      },
      customNodes: {
        notify: {
          name: 'Notify',
          nodes: [node('p', 'push-send-notification')],
          protection: serverOnly,
        },
        clean: { name: 'Clean', nodes: [node('d', 'file-storage-delete')], protection: serverOnly },
      },
    })
    expect(refusals).toEqual([
      expect.objectContaining({
        ownerKind: 'custom-node',
        nodeId: 'p',
        calledFrom: 'Notify Everyone',
      }),
    ])
    expect(shownSentence(new PublicStepRefusalError(refusals))).toContain(
      'started from "Notify Everyone"'
    )
  })

  it('checks a disabled workflow too — the generator emits every workflow it is given', () => {
    expect(
      findPublicRestrictedSteps({
        workflows: { w: pageWorkflow([node('f', 'file-storage-list')], { disabled: true }) },
      })
    ).toHaveLength(1)
  })

  it('allows them where the route knows its caller', () => {
    const guarded = {
      workflows: {
        admin: pageWorkflow([node('a', 'file-storage-delete')], { protection: ADMIN }),
        cron: pageWorkflow([node('c', 'push-send-notification')], {
          trigger: { type: 'event-cron-triggered' },
        }),
        automation: pageWorkflow([node('d', 'push-send-notification')], {
          trigger: { type: 'event-business-event', config: { eventType: 'order-placed' } },
        }),
        signedHook: pageWorkflow([node('e', 'push-send-notification')], {
          trigger: { type: 'event-webhook-received' },
          webhookConfig: { urlPath: 'notify', verifySignature: true, signatureSecret: 'HOOK' },
        }),
        plain: pageWorkflow([node('g', 'file-storage-upload'), node('h', 'data-select')]),
      },
      customNodes: {
        serverOnly: {
          name: 'Server',
          nodes: [node('i', 'push-send-notification')],
          protection: { requiresAuth: false, allowedRoles: [] as string[], serverOnly: true },
        },
      },
    }
    expect(findPublicRestrictedSteps(guarded)).toEqual([])
  })

  it('says which step, where, and what to change, in one sentence the editor shows', () => {
    const error = new PublicStepRefusalError(
      findPublicRestrictedSteps({
        workflows: { w1: pageWorkflow([node('n1', 'push-send-notification', 'Tell Everyone')]) },
      })
    )
    const sentence = shownSentence(error)
    expect(sentence).toContain('"Tell Everyone"')
    expect(sentence).toContain('"Notify Everyone"')
    expect(sentence).toContain('which any visitor can start')
    expect(sentence).toContain('let only the role "admin" start it')
    expect(sentence).toContain('admin-panel pages admit it')
    expect(sentence).toMatch(/publish again\.$/)
    expect(sentence).not.toMatch(/[\r\n]/)
    expect(sentence.length).toBeLessThanOrEqual(400)
    expect(error).toBeInstanceOf(PublicStepRefusalError)
  })

  it('stays one short sentence for many steps', () => {
    const nodes = Array.from({ length: 12 }, (_, i) =>
      node(
        `n${i}`,
        'file-storage-delete',
        `Delete The Customer Upload Number ${i} Forever And Ever`
      )
    )
    const sentence = shownSentence(
      new PublicStepRefusalError(
        findPublicRestrictedSteps({ workflows: { w1: pageWorkflow(nodes) } })
      )
    )
    expect(sentence.length).toBeLessThanOrEqual(400)
    expect(sentence).toContain('and 11 more')
    expect(sentence).toContain('admin-panel pages admit')
  })

  it('stops generation before any code is emitted', async () => {
    const plugin = new NextWorkflowProjectPlugin()
    await expect(
      plugin.runBefore(
        structure({ workflows: { w1: pageWorkflow([node('n1', 'push-send-notification')]) } })
      )
    ).rejects.toBeInstanceOf(PublicStepRefusalError)
    await expect(
      plugin.runBefore(
        structure({
          workflows: {
            w1: pageWorkflow([node('n1', 'push-send-notification')], { protection: ADMIN }),
          },
        })
      )
    ).resolves.toBeDefined()
  })

  /**
   * The store's admin Assets page and image picker, exactly as teleport-gui
   * exports them (fixture written by its spec
   * `mappers/domain-to-uidl/workflows/__tests__/admin-file-steps-protection.spec.ts`):
   * every one is admin-only, whether a page claims it or not, so the store
   * publishes. The same workflows without their policy are refused.
   */
  it.each(Object.keys(adminFileWorkflows))(
    'publishes a store’s admin file workflows (%s)',
    async (scenario) => {
      const exported = (adminFileWorkflows as Record<string, any[]>)[scenario]
      const toWorkflows = (withPolicy: boolean) => ({
        workflows: Object.fromEntries(
          exported.map((workflow, index) => [
            `admin-${index}`,
            {
              name: workflow.name,
              trigger: { type: workflow.triggerType },
              nodes: workflow.steps.map((type: string, step: number) =>
                node(`admin-${index}-${step}`, type)
              ),
              edges: [] as unknown[],
              ...(withPolicy && workflow.protection
                ? { protection: { ...workflow.protection, derivedFrom: 'page' } }
                : {}),
            },
          ])
        ),
      })
      expect(exported.length).toBeGreaterThan(3)
      const plugin = new NextWorkflowProjectPlugin()
      await expect(plugin.runBefore(structure(toWorkflows(true)))).resolves.toBeDefined()
      await expect(plugin.runBefore(structure(toWorkflows(false)))).rejects.toBeInstanceOf(
        PublicStepRefusalError
      )
    }
  )
})
