// Regression test for the abandoned-cart reminder feature's codegen dependency:
// a scheduled (cron) workflow must generate a route that (a) executes a
// `general-loop` body per row and (b) merges an email node's `templateParams`
// into its component body — the cron route previously used a naive inline loop
// that did neither, so a per-cart reminder email would ship raw {{token}} merge
// fields and its loop body would never run.
import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'
import { generateCronAPIRoute } from '../src/api-route-generator'

const TRIGGER_ID = 'cron-1'
const SCAN_ID = 'scan-1'
const LOOP_ID = 'loop-1'
const SHIM_ID = 'shim-1'
const CREATE_ID = 'create-1'
const EMAIL_ID = 'email-1'

const buildCronWorkflow = (): any => ({
  id: 'wf-abandoned-cart',
  name: 'Abandoned Cart Reminder',
  trigger: {
    type: 'event-cron-triggered',
    nodeId: TRIGGER_ID,
    scope: 'global',
    config: { schedule: '0 * * * *', timezone: 'UTC', urlPath: 'cron_abandoned' },
  },
  nodes: [
    {
      id: SCAN_ID,
      type: 'data-raw-query',
      config: { dataSourceId: 'ds-1', query: 'SELECT 1', params: ['2'] },
      executionEnv: 'server',
      stepNumber: 1,
      label: 'Scan Abandoned Carts',
    },
    {
      id: LOOP_ID,
      type: 'general-loop',
      config: {
        loopType: 'forEach',
        collection: { type: 'workflowContext', nodeId: SCAN_ID, path: [SCAN_ID, 'result'] },
        itemVariable: 'cart',
      },
      executionEnv: 'server',
      stepNumber: 2,
      label: 'Loop Over Each Abandoned Cart',
    },
    {
      id: SHIM_ID,
      type: 'general-custom-js',
      config: { code: 'function customHandler(p){return {email:"a@b.c"}}', context: 'server' },
      executionEnv: 'server',
      stepNumber: 3,
      label: 'Build Reminder Payload',
    },
    {
      id: CREATE_ID,
      type: 'data-create-item',
      config: { dataSourceId: 'ds-1', tableName: 'teleport_abandoned_carts', columnMappings: [] },
      executionEnv: 'server',
      stepNumber: 4,
      label: 'Record Abandoned Cart',
    },
    {
      id: EMAIL_ID,
      type: 'email-resend',
      config: {
        to: { type: 'workflowContext', nodeId: SHIM_ID, path: [SHIM_ID, 'email'] },
        subject: 'You left something in your cart at {{companyName}}',
        body: '<p>Hi {{customerName}}</p>',
        templateParams: [
          { key: 'customerName', value: 'Jane' },
          { key: 'companyName', value: 'Acme' },
        ],
        apiKey: '',
        emailType: 'transactional',
      },
      executionEnv: 'server',
      stepNumber: 5,
      label: 'Send Abandoned Cart Reminder',
    },
  ],
  edges: [
    { id: 'e1', source: TRIGGER_ID, target: SCAN_ID },
    { id: 'e2', source: SCAN_ID, target: LOOP_ID },
    {
      id: 'e3',
      source: LOOP_ID,
      target: SHIM_ID,
      sourceHandle: 'loop',
      targetHandle: 'loop-body-in',
    },
    {
      id: 'e4',
      source: SHIM_ID,
      target: CREATE_ID,
      sourceHandle: 'loop-body-out',
      targetHandle: 'loop-body-in',
    },
    {
      id: 'e5',
      source: CREATE_ID,
      target: EMAIL_ID,
      sourceHandle: 'loop-body-out',
      targetHandle: 'loop-body-in',
    },
    {
      id: 'e6',
      source: EMAIL_ID,
      target: LOOP_ID,
      sourceHandle: 'loop-body-out',
      targetHandle: 'loop-back',
    },
  ],
})

describe('generateCronAPIRoute — loop + templateParams support', () => {
  const route = generateCronAPIRoute(buildCronWorkflow())

  it('uses the loop-capable executor (handles general-loop body discovery)', () => {
    // The shared execution loop keys the loop body off the 'loop' sourceHandle
    // and walks 'loop-body-out' edges — markers absent from the old naive loop.
    expect(route).toContain("e.sourceHandle === 'loop'")
    expect(route).toContain('loop-body-out')
  })

  it('merges templateParams into email body + subject', () => {
    // The merge lives in the SHARED runtime's `resolveConfig`, not pasted at
    // each call site. That is the whole point: `resolveConfig` is the single
    // function every execution path — main loop, loop body, parallel branch,
    // error branch, across all four route generators and the client executor —
    // funnels a node config through. Pasting it per site is what left the main
    // loop of `generateServerSegmentAPIRoute` (where every ordinary page
    // workflow's email node runs) without it, shipping literal `{{token}}`s.
    const runtime = generateSharedRuntimeUtilsCode()
    expect(runtime).toContain('applyTemplateParams(resolved.body, resolved.templateParams)')
    expect(runtime).toContain('applyTemplateParams(resolved.subject, resolved.templateParams)')
    // …and the route reaches it simply by calling resolveConfig.
    expect(route).toContain('const resolveConfig = utils.resolveConfig')
    // No stale per-site copy left behind to drift out of sync.
    expect(route).not.toContain('utils.applyTemplateParams(')
  })

  it('bakes the scan + loop + email nodes into the server WORKFLOW_CONFIG', () => {
    expect(route).toContain('"type": "general-loop"')
    expect(route).toContain('"type": "email-resend"')
    expect(route).toContain('"type": "data-raw-query"')
  })

  it('emits a self-contained cron handler with the schedule + success response', () => {
    expect(route).toContain("schedule: '0 * * * *'")
    expect(route).toContain('res.status(200).json({ success: true')
  })
})
