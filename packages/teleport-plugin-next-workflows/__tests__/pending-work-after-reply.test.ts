import { generateServerSegmentAPIRoute } from '../src/api-route-generator'
import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'
import { isFireAndForgetNode } from '../src/await-result'
import { NextWorkflowProjectPlugin } from '../src/workflow-project-plugin'
import { VERCEL_FUNCTIONS_PACKAGE, VERCEL_FUNCTIONS_VERSION } from '../src/vercel-functions'
import type { WorkflowSegment } from '../src/types'
import { loadServerRuntime } from './_helpers/load-server-runtime'

/**
 * A step the author chose not to wait for still has to finish on the server,
 * but the visitor no longer waits for it: a cash order's invoice (rendered,
 * stored and mailed, 8–14 s) runs on after the segment has replied. On Vercel
 * the route hands that work to waitUntil; anywhere else it awaits it before
 * replying, as before.
 */

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context')

const invoiceNode = (awaitResult?: boolean) => ({
  id: 'invoice',
  type: 'ecommerce-generate-invoice',
  label: 'Generate Invoice',
  stepNumber: 1,
  config: { orderId: 'order-1', ...(awaitResult === undefined ? {} : { awaitResult }) },
})

const segmentOf = (node: ReturnType<typeof invoiceNode>): WorkflowSegment =>
  ({
    id: 'seg-cash',
    env: 'server',
    nodeIds: [node.id],
    nodes: [node],
    edges: [],
  } as unknown as WorkflowSegment)

const deferred = () => {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const settleMicrotasks = () => new Promise((done) => setTimeout(done, 20))

interface Reply {
  status: number
  body: any
}

const originalFetch = globalThis.fetch

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  globalThis.fetch = originalFetch
  delete (globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT]
})

/**
 * Boots the generated segment route with `modules` installed, and an invoice
 * route that answers only once `invoiceGate` opens.
 */
const bootRoute = (node: ReturnType<typeof invoiceNode>, modules: Record<string, unknown>) => {
  const invoiceGate = deferred()
  const progress = { invoiceFinished: false }
  globalThis.fetch = (async () => {
    await invoiceGate.promise
    progress.invoiceFinished = true
    return { ok: true, status: 200, json: async () => ({ invoiceId: 'inv-1' }) }
  }) as unknown as typeof fetch

  const runtime = loadServerRuntime(modules)
  const routeModule: { exports: unknown } = { exports: {} }
  // tslint:disable-next-line:function-constructor
  new Function('module', 'exports', 'require', generateServerSegmentAPIRoute(segmentOf(node)))(
    routeModule,
    routeModule.exports,
    (id: string) => {
      if (id.endsWith('server-runtime')) {
        return runtime
      }
      throw new Error('Unexpected require: ' + id)
    }
  )
  const handler = routeModule.exports as (req: unknown, res: unknown) => Promise<void>
  const reply: Reply = { status: 0, body: undefined }
  const res = {
    status(code: number) {
      reply.status = code
      return this
    },
    json(payload: unknown) {
      reply.body = payload
      return this
    },
    setHeader: (): void => undefined,
  }
  const handled = handler(
    { method: 'POST', body: { context: {} }, headers: { host: 'shop.example' } },
    res
  )
  return { handled, reply, progress, openInvoiceGate: invoiceGate.resolve }
}

const onVercel = () => {
  ;(globalThis as Record<symbol, unknown>)[REQUEST_CONTEXT] = {
    get: () => ({ waitUntil: (): void => undefined }),
  }
}

const fakeVercelFunctions = () => {
  const handedOff: Array<Promise<unknown>> = []
  return {
    handedOff,
    module: {
      waitUntil: (promise: Promise<unknown>) => {
        handedOff.push(promise)
      },
    },
  }
}

describe('the invoice step may be left not awaited', () => {
  it('is fire-and-forget only on an explicit awaitResult: false', () => {
    expect(isFireAndForgetNode(invoiceNode(false) as never)).toBe(true)
    expect(isFireAndForgetNode(invoiceNode(true) as never)).toBe(false)
    expect(isFireAndForgetNode(invoiceNode() as never)).toBe(false)
  })

  it('is mirrored inside the generated runtime', () => {
    const shared: { exports: Record<string, any> } = { exports: {} }
    // tslint:disable-next-line:function-constructor
    new Function('module', 'exports', generateSharedRuntimeUtilsCode())(shared, shared.exports)
    expect(shared.exports.isFireAndForgetNode(invoiceNode(false))).toBe(true)
    expect(shared.exports.isFireAndForgetNode(invoiceNode())).toBe(false)
  })
})

describe('a segment route with a not-awaited step', () => {
  it('replies on Vercel before the step finishes, and hands the step to waitUntil', async () => {
    onVercel()
    const vercel = fakeVercelFunctions()
    const run = bootRoute(invoiceNode(false), { [VERCEL_FUNCTIONS_PACKAGE]: vercel.module })

    const outcome = await Promise.race([
      run.handled.then(() => 'replied'),
      settleMicrotasks().then(() => 'still waiting'),
    ])

    expect(outcome).toBe('replied')
    expect(run.reply.status).toBe(200)
    expect(run.reply.body.success).toBe(true)
    expect(run.progress.invoiceFinished).toBe(false)
    expect(vercel.handedOff).toHaveLength(1)

    run.openInvoiceGate()
    await vercel.handedOff[0]
    expect(run.progress.invoiceFinished).toBe(true)
  })

  it('waits for the step before replying outside a Vercel request', async () => {
    const vercel = fakeVercelFunctions()
    const run = bootRoute(invoiceNode(false), { [VERCEL_FUNCTIONS_PACKAGE]: vercel.module })

    await settleMicrotasks()
    expect(run.reply.status).toBe(0)

    run.openInvoiceGate()
    await run.handled
    expect(run.progress.invoiceFinished).toBe(true)
    expect(run.reply.status).toBe(200)
    expect(vercel.handedOff).toHaveLength(0)
  })

  it('waits for the step before replying when @vercel/functions is not installed', async () => {
    onVercel()
    const run = bootRoute(invoiceNode(false), {})

    await settleMicrotasks()
    expect(run.reply.status).toBe(0)

    run.openInvoiceGate()
    await run.handled
    expect(run.progress.invoiceFinished).toBe(true)
    expect(run.reply.status).toBe(200)
  })

  it('still runs an awaited invoice step before replying, on Vercel too', async () => {
    onVercel()
    const vercel = fakeVercelFunctions()
    const run = bootRoute(invoiceNode(), { [VERCEL_FUNCTIONS_PACKAGE]: vercel.module })

    await settleMicrotasks()
    expect(run.reply.status).toBe(0)

    run.openInvoiceGate()
    await run.handled
    expect(run.reply.body.results.invoice.invoiceId).toBe('inv-1')
    expect(vercel.handedOff).toHaveLength(0)
  })
})

describe('the generated project declares @vercel/functions', () => {
  const generate = async (
    workflows: Record<string, unknown>,
    dependencies: Record<string, string> = {}
  ) => {
    const structure: any = {
      uidl: {
        name: 'Store',
        globals: { settings: { title: 'Store', language: 'en' }, env: {} },
        root: {
          name: 'Root',
          stateDefinitions: {
            route: { type: 'string', defaultValue: 'Home', values: [{ value: 'Home' }] },
          },
          node: { type: 'element', content: { elementType: 'container', children: [] } },
        },
        components: {},
        workflows: { workflows },
      },
      strategy: { pages: { options: {} } },
      files: new Map(),
      dependencies: { ...dependencies },
      devDependencies: {},
    }
    await new NextWorkflowProjectPlugin().runAfter(structure)
    return structure
  }

  const cronWorkflow = {
    id: 'wf-cron',
    name: 'Nightly count',
    trigger: {
      type: 'event-cron-triggered',
      nodeId: 't',
      scope: 'global',
      config: { schedule: '0 * * * *', urlPath: 'cron_nightly' },
    },
    nodes: [
      {
        id: 'count',
        type: 'data-count',
        config: { dataSourceId: 'ds-1', tableName: 'orders', filters: [] },
        stepNumber: 1,
        label: 'Count orders',
      },
    ],
    edges: [{ id: 'e1', source: 't', target: 'count' }],
  }

  const filesRequiringIt = (structure: any): string[] => {
    const names: string[] = []
    for (const record of structure.files.values()) {
      for (const file of record.files || []) {
        if (
          typeof file.content === 'string' &&
          file.content.includes(`require('${VERCEL_FUNCTIONS_PACKAGE}')`)
        ) {
          names.push([...record.path, file.name].join('/'))
        }
      }
    }
    return names
  }

  it('when an emitted file requires it', async () => {
    const structure = await generate({ [cronWorkflow.id]: cronWorkflow })

    expect(filesRequiringIt(structure)).toContain('utils/workflows/server-runtime')
    expect(structure.dependencies[VERCEL_FUNCTIONS_PACKAGE]).toBe(VERCEL_FUNCTIONS_VERSION)
  })

  it('keeps a version the project already declares', async () => {
    const structure = await generate(
      { [cronWorkflow.id]: cronWorkflow },
      { [VERCEL_FUNCTIONS_PACKAGE]: '^2.2.10' }
    )

    expect(filesRequiringIt(structure)).toContain('utils/workflows/server-runtime')
    expect(structure.dependencies[VERCEL_FUNCTIONS_PACKAGE]).toBe('^2.2.10')
  })

  it('never without a file that requires it', async () => {
    const structure = await generate({})

    expect(filesRequiringIt(structure)).toEqual([])
    expect(structure.dependencies[VERCEL_FUNCTIONS_PACKAGE]).toBeUndefined()
  })
})
