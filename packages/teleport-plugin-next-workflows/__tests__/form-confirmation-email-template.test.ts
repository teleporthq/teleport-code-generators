import { loadServerRuntime } from './_helpers/load-server-runtime'

/**
 * The confirmation email a converted form sends (teleport-gui
 * `real-data/apply/applicators/convert-form.ts`) is the author's template —
 * one "Label: {{column}}" line per answer — with the answers as
 * `templateParams` bound to the form check's values. Filled in on the
 * server, the template stays HTML and every answer is escaped once.
 */

const VALIDATE_ID = 'check-the-form'

const confirmationEmail = {
  to: { type: 'workflowContext', nodeId: VALIDATE_ID, path: ['values', 'email'] },
  subject: 'Thanks',
  body: '<p><strong>Driver name:</strong> {{driver_name}}</p><p><strong>Email:</strong> {{email}}</p>',
  templateParams: [
    {
      key: 'driver_name',
      value: { type: 'workflowContext', nodeId: VALIDATE_ID, path: ['values', 'driver_name'] },
    },
    {
      key: 'email',
      value: { type: 'workflowContext', nodeId: VALIDATE_ID, path: ['values', 'email'] },
    },
  ],
  emailType: 'transactional',
}

describe('a converted form’s confirmation email', () => {
  it('renders the template as HTML with the visitor’s answers escaped', () => {
    const runtime = loadServerRuntime()
    const resolved = runtime.resolveConfig(confirmationEmail, {
      [VALIDATE_ID]: {
        values: { driver_name: '<b>Ann & "Bob"</b>', email: 'ann@example.com' },
      },
    })
    expect(resolved.body).toBe(
      '<p><strong>Driver name:</strong> &lt;b&gt;Ann &amp; &quot;Bob&quot;&lt;/b&gt;</p>' +
        '<p><strong>Email:</strong> ann@example.com</p>'
    )
    expect(resolved.to).toBe('ann@example.com')
  })
})
