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
