import { generateSharedRuntimeUtilsCode } from '../src'

// Regression guard for the "reset URL never appears in the password-reset
// email" bug.
//
// The email-body rich-text editor stores dynamic values as inline embed spans:
//   <span class="context-value-inline" data-ctx-node-id="<id>"
//         data-ctx-path='["<id>","result"]'>Label</span>
// The shared runtime's resolveConfig used to leave plain strings untouched, so
// the email body was delivered with the literal placeholder label
// ("Reset URL") instead of the resolved value. resolveRichTextContext now
// resolves these spans against the workflow context, and resolveConfig routes
// every scalar string through it.
//
// This file extracts the real generated runtime (so any refactor that drops or
// weakens the resolution fails loudly) and exercises both serialization forms
// the editor emits.

type SharedUtils = {
  resolveConfig: (cfg: unknown, ctx: Record<string, unknown>) => any
  resolveRichTextContext: (html: string, ctx: Record<string, unknown>) => string
  applyTemplateParams: (text: string, params: unknown) => string
  expandListBlocks: (text: string, lists: Record<string, unknown>) => string
}

function loadSharedRuntime(): SharedUtils {
  const src = generateSharedRuntimeUtilsCode()
  const wrapper: { exports: Record<string, unknown> } = { exports: {} }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', src)(wrapper, wrapper.exports)
  return wrapper.exports as unknown as SharedUtils
}

const RESET_NODE_ID = '132020b3-6c89-46a4-a280-d29c9a66d4e5'

// The exact Quill-serialized body the auth feature stores on the send-email
// node (note the &quot;-escaped data-ctx-path and the nested inner span with
// BOM markers around the label).
const QUILL_BODY =
  '<p><strong>Reset Your Password</strong></p>' +
  '<p>We received a request to reset your password. Click the link below to set a new password:</p>' +
  `<p><span class="context-value-inline" data-ctx-node-id="${RESET_NODE_ID}" ` +
  `data-ctx-path="[&quot;${RESET_NODE_ID}&quot;,&quot;result&quot;]" data-ctx-label="Reset URL" ` +
  'contenteditable="false" draggable="false">﻿<span contenteditable="false">Reset URL</span>﻿</span></p>' +
  '<p>This link will expire in 30 minutes. If you did not request a password reset, you can safely ignore this email.</p>' +
  '<p><br></p><p>This is an automated message. Please do not reply.</p>'

describe('email body inline-context resolution', () => {
  const utils = loadSharedRuntime()
  const RESET_URL = 'http://localhost:3002/reset-password?token=abc-123'
  const ctx = { [RESET_NODE_ID]: { result: RESET_URL } }

  it('exposes resolveRichTextContext from the generated runtime', () => {
    expect(typeof utils.resolveRichTextContext).toBe('function')
  })

  it('interpolates the reset URL into the Quill-serialized body via resolveConfig', () => {
    const resolved = utils.resolveConfig({ body: QUILL_BODY, subject: 'Reset Your Password' }, ctx)
    expect(resolved.body).toContain(RESET_URL)
    expect(resolved.body).not.toContain('context-value-inline')
    expect(resolved.body).not.toContain('>Reset URL<')
    // surrounding copy is preserved verbatim
    expect(resolved.body).toContain('<p><strong>Reset Your Password</strong></p>')
    expect(resolved.body).toContain('<p>This link will expire in 30 minutes.')
    // non-rich-text fields are untouched
    expect(resolved.subject).toBe('Reset Your Password')
  })

  it('resolves the single-quoted raw-JSON builder form exactly', () => {
    const body =
      '<p>Link: <span class="context-value-inline" data-ctx-node-id="N1" ' +
      'data-ctx-path=\'["N1","result"]\' data-ctx-label="Reset URL" contenteditable="false" ' +
      'draggable="false">Reset URL</span></p>'
    const resolved = utils.resolveConfig(
      { body },
      { N1: { result: 'https://app.example.com/reset-password?token=zzz' } }
    )
    expect(resolved.body).toBe('<p>Link: https://app.example.com/reset-password?token=zzz</p>')
  })

  it('drops the placeholder to empty when the context value is missing', () => {
    const body =
      '<p>Link: <span class="context-value-inline" data-ctx-node-id="N1" ' +
      'data-ctx-path=\'["N1","result"]\'>Reset URL</span></p>'
    expect(utils.resolveConfig({ body }, {}).body).toBe('<p>Link: </p>')
  })

  it('HTML-escapes the resolved value', () => {
    const body =
      '<p><span class="context-value-inline" data-ctx-node-id="N1" ' +
      'data-ctx-path=\'["N1","result"]\'>x</span></p>'
    const resolved = utils.resolveConfig({ body }, { N1: { result: 'a=1&b=2&c=<x>' } })
    expect(resolved.body).toBe('<p>a=1&amp;b=2&amp;c=&lt;x&gt;</p>')
  })

  it('resolves multiple embed spans in a single body', () => {
    const body =
      '<p>Hi <span class="context-value-inline" data-ctx-node-id="N1" data-ctx-path=\'["N1","result"]\'>Name</span>, ' +
      'reset: <span class="context-value-inline" data-ctx-node-id="N2" data-ctx-path=\'["N2","result"]\'>URL</span></p>'
    const resolved = utils.resolveConfig(
      { body },
      { N1: { result: 'Ada' }, N2: { result: 'https://x/reset?token=1' } }
    )
    expect(resolved.body).toBe('<p>Hi Ada, reset: https://x/reset?token=1</p>')
  })

  it('leaves unrelated <span> elements and plain strings untouched', () => {
    const body = '<p><span class="hl">keep me</span> and a&amp;b</p>'
    const resolved = utils.resolveConfig({ body, label: 'Hello & welcome', count: 5 }, {})
    expect(resolved.body).toBe(body)
    expect(resolved.label).toBe('Hello & welcome')
    expect(resolved.count).toBe(5)
  })

  it('routes the Quill body to the exact reset URL the workflow computed', () => {
    // origin (from url-get-current-url) + the reset page path + the generated token,
    // exactly as the transform-string node assembles it.
    const computedUrl = 'https://store.teleporthq.app/reset-password?token=e8f2720b'
    const out = utils.resolveRichTextContext(QUILL_BODY, {
      [RESET_NODE_ID]: { result: computedUrl },
    })
    expect(out).toContain(computedUrl)
    expect(out).not.toContain('Reset URL</span>')
  })
})

// Guards the component-body path: a send-email node whose body is a serialized
// email-template component carries flat {{token}} merge fields filled at runtime
// from templateParams (resolveConfig resolves each param's context ref first,
// then executeNodes calls applyTemplateParams on body + subject).
describe('email template params substitution', () => {
  const utils = loadSharedRuntime()

  it('exposes applyTemplateParams from the generated runtime', () => {
    expect(typeof utils.applyTemplateParams).toBe('function')
  })

  it('fills {{token}} in body + subject from resolved templateParams (executeNodes flow)', () => {
    const config = {
      subject: 'Reset {{recipientEmail}}',
      body: '<a href="{{resetUrl}}">Reset</a> for {{recipientEmail}}',
      templateParams: [
        {
          key: 'resetUrl',
          value: { type: 'workflowContext', nodeId: 'N1', path: ['N1', 'result'] },
        },
        { key: 'recipientEmail', value: 'jane@example.com' },
      ],
    }
    // Step 1: resolveConfig resolves each param's context ref (as executeNodes does).
    const resolved = utils.resolveConfig(config, {
      N1: { result: 'https://app.example.com/reset-password?token=abc' },
    })
    // Step 2: executeNodes applies the params to body + subject.
    const body = utils.applyTemplateParams(resolved.body, resolved.templateParams)
    const subject = utils.applyTemplateParams(resolved.subject, resolved.templateParams)
    expect(body).toBe(
      '<a href="https://app.example.com/reset-password?token=abc">Reset</a> for jane@example.com'
    )
    expect(subject).toBe('Reset jane@example.com')
  })

  it('leaves unknown tokens verbatim (never blanks a campaign {{name}})', () => {
    const out = utils.applyTemplateParams('Hi {{name}}, reset: {{resetUrl}}', [
      { key: 'resetUrl', value: 'https://x/reset?token=1' },
    ])
    expect(out).toBe('Hi {{name}}, reset: https://x/reset?token=1')
  })

  it('does not partial-match longer tokens ({{total}} vs {{totalAmount}})', () => {
    const out = utils.applyTemplateParams('{{total}} of {{totalAmount}}', [
      { key: 'total', value: '5' },
      { key: 'totalAmount', value: '$99' },
    ])
    expect(out).toBe('5 of $99')
  })

  it('is a no-op when there are no params or body is not a string', () => {
    expect(utils.applyTemplateParams('{{x}}', [])).toBe('{{x}}')
    expect(utils.applyTemplateParams('{{x}}', undefined)).toBe('{{x}}')
  })

  // ── Array-mapper loop-block expansion (builder array mapper → email list) ──

  it('expands a <!--tq:each--> block from an array templateParam, once per row', () => {
    const body =
      'Items:<!--tq:each products--><li>{{quantity}}x <strong>{{product_name}}</strong> — {{companyName}}</li><!--/tq:each-->end'
    const out = utils.applyTemplateParams(body, [
      {
        key: 'products',
        value: [
          { product_name: 'Espresso Beans', quantity: 2 },
          { product_name: 'Ceramic Mug', quantity: 1 },
        ],
      },
      { key: 'companyName', value: 'Acme Inc.' },
    ])
    // one <li> per row, row tokens filled from the row object
    expect(out).toContain('<li>2x <strong>Espresso Beans</strong> — Acme Inc.</li>')
    expect(out).toContain('<li>1x <strong>Ceramic Mug</strong> — Acme Inc.</li>')
    // the {{companyName}} inside the row (not a row field) resolved via the flat fill
    expect(out).not.toContain('{{companyName}}')
    // no leftover sentinels or tokens
    expect(out).not.toContain('<!--tq:each')
    expect(out).not.toContain('<!--/tq:each-->')
    expect(out).not.toContain('{{product_name}}')
  })

  it('HTML-escapes per-row values (no markup injection from item data)', () => {
    const out = utils.expandListBlocks('<!--tq:each products-->[{{name}}]<!--/tq:each-->', {
      products: [{ name: '<b>x</b> & "y"' }],
    })
    expect(out).toBe('[&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;]')
  })

  it('renders an empty string for a missing/non-array list key', () => {
    const body = 'a<!--tq:each products-->{{name}}<!--/tq:each-->b'
    expect(utils.applyTemplateParams(body, [])).toBe('ab')
    expect(utils.applyTemplateParams(body, [{ key: 'products', value: 'not-an-array' }])).toBe('ab')
  })

  it('resolveConfig preserves an array-valued templateParam so the block expands', () => {
    // Mirrors the withdrawal send node: templateParams is an array of {key,value}
    // where value is a workflowContext ref that resolves to the items array.
    const config = {
      body: 'X<!--tq:each products--><li>{{quantity}}x {{product_name}}</li><!--/tq:each-->Y',
      templateParams: [
        {
          key: 'products',
          value: {
            type: 'workflowContext',
            nodeId: 'assemble',
            path: ['assemble', 'selectedItems'],
          },
        },
        { key: 'companyName', value: 'Acme Inc.' },
      ],
    }
    const ctx = {
      assemble: { selectedItems: [{ product_name: 'Espresso Beans', quantity: 3 }] },
    }
    const resolved = utils.resolveConfig(config, ctx)
    // the array survived resolution (was not String()-joined)
    expect(Array.isArray(resolved.templateParams[0].value)).toBe(true)
    const out = utils.applyTemplateParams(resolved.body, resolved.templateParams)
    expect(out).toContain('<li>3x Espresso Beans</li>')
    expect(out).not.toContain('<!--tq:each')
  })
})
