import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'
import { generateServerSegmentAPIRoute } from '../src/api-route-generator'

/**
 * Regression: every component-bodied transactional email shipped with its
 * `{{token}}` merge fields unfilled.
 *
 * The fill was pasted at individual call sites instead of living in the one
 * function every path shares. It reached only three of the sixteen sites — the
 * client executor, and the main + loop-body loops of the cron/webhook route —
 * so the MAIN loop of `generateServerSegmentAPIRoute`, where every ordinary
 * page workflow's email node actually executes, never applied it. Delivered
 * result: literal `{{customerName}}` / `{{orderNumber}}` in the body, the same
 * in the SUBJECT line, an un-expanded `<!--tq:each products-->` row block, and
 * `href="{{resetUrl}}"` on the password-reset button — an invalid relative URL
 * that mail clients drop, so the button had no link at all.
 *
 * These tests EXECUTE the emitted runtime rather than grepping it: the defect
 * was never a missing function, it was a function nobody called.
 */

type ResolveConfig = (
  config: Record<string, unknown>,
  context: Record<string, unknown>
) => Record<string, unknown>

function loadRuntime(): { resolveConfig: ResolveConfig } {
  const code = generateSharedRuntimeUtilsCode()
  const moduleShim = { exports: {} as Record<string, unknown> }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', 'process', code)(
    moduleShim,
    moduleShim.exports,
    () => ({}),
    { env: {} }
  )
  const exported = (moduleShim.exports as { resolveConfig?: ResolveConfig }).resolveConfig
  if (typeof exported !== 'function') {
    throw new Error('server-runtime does not export resolveConfig')
  }
  return { resolveConfig: exported }
}

const wfCtx = (nodeId: string, path: string[]) => ({
  type: 'workflowContext',
  nodeId,
  path: [nodeId, ...path],
})

describe('resolveConfig fills component-bodied email templates', () => {
  const { resolveConfig } = loadRuntime()

  const context = {
    assemble: {
      customerName: 'Jane Cooper',
      orderNumber: 'ORD-42',
      products: [
        { product_name: 'Beans', quantity: '2', unit_price: '12.00', currency: 'USD' },
        { product_name: 'Mug', quantity: '1', unit_price: '15.00', currency: 'USD' },
      ],
    },
    buildRef: { result: 'WDR-7' },
  }

  const emailConfig = (over: Record<string, unknown> = {}) => ({
    to: 'jane@example.com',
    subject: 'New withdrawal request {{requestReference}} for order {{orderNumber}}',
    body: '<p>Submitted by {{customerName}} for order {{orderNumber}}.</p>',
    templateParams: [
      { key: 'customerName', value: wfCtx('assemble', ['customerName']) },
      { key: 'orderNumber', value: wfCtx('assemble', ['orderNumber']) },
      { key: 'requestReference', value: wfCtx('buildRef', ['result']) },
      { key: 'products', value: wfCtx('assemble', ['products']) },
      { key: 'companyName', value: 'Acme Inc.' },
    ],
    ...over,
  })

  it('fills the BODY from workflow-context-bound params', () => {
    const resolved = resolveConfig(emailConfig(), context)
    expect(resolved.body).toBe('<p>Submitted by Jane Cooper for order ORD-42.</p>')
  })

  it('fills the SUBJECT too — the email title had the same defect', () => {
    const resolved = resolveConfig(emailConfig(), context)
    expect(resolved.subject).toBe('New withdrawal request WDR-7 for order ORD-42')
  })

  it('fills a literal (non-bound) param value', () => {
    const resolved = resolveConfig(emailConfig({ body: '<p>Sent by {{companyName}}</p>' }), context)
    expect(resolved.body).toBe('<p>Sent by Acme Inc.</p>')
  })

  it('expands the array-mapper row block before the flat fill', () => {
    const resolved = resolveConfig(
      emailConfig({
        body: '<div><!--tq:each products--><li>{{quantity}}x {{product_name}} @ {{unit_price}} {{currency}}</li><!--/tq:each--></div>',
      }),
      context
    )
    expect(resolved.body).toBe(
      '<div><li>2x Beans @ 12.00 USD</li><li>1x Mug @ 15.00 USD</li></div>'
    )
    expect(resolved.body).not.toContain('<!--tq:each')
  })

  it('produces a REAL href on a token-bound link', () => {
    // The password-reset button serializes to href="{{resetUrl}}". Unfilled,
    // that is a relative URL mail clients discard — the reported "the reset
    // button has no link".
    const resolved = resolveConfig(
      {
        subject: 'Password Reset Request',
        body: '<a href="{{resetUrl}}">Reset password</a>',
        templateParams: [{ key: 'resetUrl', value: wfCtx('buildLink', ['resetLink']) }],
      },
      { buildLink: { resetLink: 'https://shop.example.com/reset?token=abc' } }
    )
    expect(resolved.body).toBe(
      '<a href="https://shop.example.com/reset?token=abc">Reset password</a>'
    )
  })

  it('leaves configs without templateParams untouched', () => {
    const resolved = resolveConfig({ query: 'SELECT 1', body: 'not {{anything}} special' }, context)
    expect(resolved.body).toBe('not {{anything}} special')
  })

  it('does not choke when body/subject are absent or non-string', () => {
    const resolved = resolveConfig(
      { templateParams: [{ key: 'a', value: 'b' }], to: ['x@y.z'] },
      context
    )
    expect(resolved.to).toEqual(['x@y.z'])
  })
})

describe('the server-segment route reaches the fill', () => {
  // The route that runs every ordinary page workflow's server nodes. It had no
  // fill of its own; it must now get one purely by calling resolveConfig.
  const route = generateServerSegmentAPIRoute(
    {
      id: 'server-1',
      env: 'server',
      nodeIds: ['n1'],
      nodes: [
        {
          id: 'n1',
          type: 'email-resend',
          label: 'Send Withdrawal Confirmation Email',
          stepNumber: 1,
          config: {
            to: 'a@b.c',
            subject: 'Ref {{requestReference}}',
            body: '<p>{{customerName}}</p>',
            templateParams: [{ key: 'customerName', value: 'Jane' }],
          },
        },
      ],
      edges: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    'Submit Withdrawal'
  )

  it('routes the node config through the shared resolveConfig', () => {
    expect(route).toContain('const resolveConfig = utils.resolveConfig')
    expect(route).toContain('resolveConfig(node.config, context)')
  })

  it('carries no private copy of the fill that could drift', () => {
    expect(route).not.toContain('applyTemplateParams')
  })
})
