import { projectUIDLDecoder } from '../../src/decoders/project-decoder'
import projectSample from '../../../../examples/test-samples/project-sample.json'

/**
 * ⛔ THE DECODER IS THE SCHEMA: a top-level field it does not name is dropped,
 * and the generator only ever sees the decoded UIDL. The newsletter's routes,
 * helper and emails are emitted by NextNewsletterProjectPlugin only when
 * `newsletterSettings` reaches it.
 */
const decode = (extra: Record<string, unknown>) =>
  projectUIDLDecoder.runWithException({ ...projectSample, ...extra }) as unknown as Record<
    string,
    unknown
  >

const NEWSLETTER_SETTINGS = {
  dataSourceId: 'ds-1',
  dataSourceType: 'teleport',
  confirmation: true,
  welcome: true,
  sender: { name: 'Studio', email: 'hello@studio.test' },
  email: { provider: 'resend', apiKeyEnv: 'EMAIL_RESEND_APIKEY', domainEnv: null },
  templates: {
    confirmation: { subject: 'Confirm', body: '<p>{{confirm_url}}</p>' },
    welcome: {
      subject: 'Welcome',
      body: '<p>{{unsubscribe_url}}</p>',
      localized: { fr: { subject: 'Bienvenue', body: '<p>{{unsubscribe_url}}</p>' } },
    },
  },
  pages: { confirm: '/newsletter/confirm', unsubscribe: '/newsletter/unsubscribe' },
  signUp: { signupCheckbox: true },
  adminRoutes: false,
}

describe('project decoder — newsletter', () => {
  it('keeps newsletterSettings whole', () => {
    expect(decode({ newsletterSettings: NEWSLETTER_SETTINGS }).newsletterSettings).toEqual(
      NEWSLETTER_SETTINGS
    )
  })

  it('leaves a project without the newsletter untouched', () => {
    expect(decode({}).newsletterSettings).toBeUndefined()
  })
})
