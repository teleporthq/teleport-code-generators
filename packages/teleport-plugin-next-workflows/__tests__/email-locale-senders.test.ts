import type { UIDLInvoiceEmailDelivery, UIDLInvoiceSettings } from '@teleporthq/teleport-types'
import { generateSignupRouteFile } from '../src/auth-generator'
import { generateAccountDeleteRoute } from '../src/account-delete-route-generator'
import { generateEmailSenderCode } from '../src/invoice/email-sender-code'
import { generateInvoiceGenerateRouteCode } from '../src/invoice/api-routes-code'
import { generateDataAPIRoute } from '../src/data-api-route-generator'
import { generateEmailLocaleModuleCode } from '../src/email-locale'
import { readLocalizedEmailTemplates } from '../src/transactional-email-code'
import { nodeRegistry } from '../src'

/**
 * The email senders that live OUTSIDE the workflow runtime — the welcome and
 * farewell routes, the invoice sender, the data-api that stamps an order's
 * language — each read the shared locale module. These tests pin that every
 * one of them selects the copy of the language it resolved, and that the
 * order row keeps the storefront language it was written from.
 */

const LOCALIZED = {
  es: { subject: 'Bienvenido {{userName}}', body: '<p>Hola {{userName}}</p>' },
}

const extractFunctionSource = (haystack: string, funcDecl: string): string => {
  const startIdx = haystack.indexOf(funcDecl)
  if (startIdx === -1) {
    throw new Error('Helper not found: ' + funcDecl)
  }
  let depth = 0
  let i = haystack.indexOf('{', startIdx)
  for (; i < haystack.length; i++) {
    const ch = haystack.charAt(i)
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        return haystack.slice(startIdx, i + 1)
      }
    }
  }
  throw new Error('Unbalanced braces for ' + funcDecl)
}

const loadLocaleModule = () => {
  const moduleShim = { exports: {} as Record<string, unknown> }
  // eslint-disable-next-line no-new-func
  new Function(
    'module',
    'exports',
    generateEmailLocaleModuleCode({ locales: ['en', 'es'], defaultLocale: 'en' })
  )(moduleShim, moduleShim.exports)
  return moduleShim.exports
}

describe('readLocalizedEmailTemplates', () => {
  it('keeps only well-formed copies', () => {
    expect(
      readLocalizedEmailTemplates({
        es: { subject: 'S', body: 'B' },
        fr: { body: 'B' },
        de: { subject: 'only a subject' },
        it: { subject: '', body: '' },
        pt: 'B',
      })
    ).toEqual({ es: { subject: 'S', body: 'B' }, fr: { body: 'B' } })
  })

  it('answers no copies for anything that is not a map', () => {
    expect(readLocalizedEmailTemplates(undefined)).toEqual({})
    expect(readLocalizedEmailTemplates([{ body: 'B' }])).toEqual({})
    expect(readLocalizedEmailTemplates('es')).toEqual({})
  })
})

describe('welcome and farewell routes', () => {
  const auth = { enabled: true, dataSourceType: 'postgresql' } as any
  const signup = generateSignupRouteFile(auth, {
    emailProvider: 'resend',
    emailSubject: 'Welcome {{userName}}',
    emailBodyHtml: '<p>Hi {{userName}}</p>',
    localizedTemplates: LOCALIZED,
  })
  const del = generateAccountDeleteRoute({
    emailProvider: 'resend',
    emailSubject: 'Goodbye {{userName}}',
    emailBodyHtml: '<p>Bye {{userName}}</p>',
    localizedTemplates: LOCALIZED,
  })

  it('bake the per-language copies and require the locale module', () => {
    expect(signup).toContain(`const WELCOME_EMAIL_LOCALIZED = ${JSON.stringify(LOCALIZED)};`)
    expect(signup).toContain("var __emailLocale = require('../../../utils/email/email-locale');")
    expect(del).toContain(`const EMAIL_LOCALIZED = ${JSON.stringify(LOCALIZED)};`)
    expect(del).toContain("var __emailLocale = require('../../../utils/email/email-locale');")
  })

  it('send the copy of the request language', () => {
    expect(signup).toContain('var copy = resolveWelcomeEmailCopy(locale);')
    expect(signup).toContain('var subject = fillTemplate(copy.subject, tokenValues);')
    expect(signup).toContain('var html = fillTemplate(copy.body, tokenValues);')
    expect(del).toContain('var copy = resolveFarewellEmailCopy(locale);')
    expect(del).toContain('var subject = fillTemplate(copy.subject, tokenValues);')
    expect(del).toContain('var html = fillTemplate(copy.body, tokenValues);')
  })

  it('resolve the language off the request at the call site', () => {
    expect(signup).toContain('newUser && newUser.id, __emailLocale.resolveRequestLocale(req));')
    expect(del).toContain('}, userId, __emailLocale.resolveRequestLocale(req));')
  })

  it('the copy selector honours the locale module rules', () => {
    const locale = loadLocaleModule()
    const selector = extractFunctionSource(signup, 'function resolveWelcomeEmailCopy(')
    // eslint-disable-next-line no-new-func
    const resolveWelcomeEmailCopy = new Function(
      '__emailLocale',
      'WELCOME_EMAIL_SUBJECT',
      'WELCOME_EMAIL_BODY_HTML',
      'WELCOME_EMAIL_LOCALIZED',
      `${selector}; return resolveWelcomeEmailCopy;`
    )(locale, 'Welcome {{userName}}', '<p>Hi {{userName}}</p>', LOCALIZED)
    expect(resolveWelcomeEmailCopy('es')).toEqual({
      subject: 'Bienvenido {{userName}}',
      body: '<p>Hola {{userName}}</p>',
      locale: 'es',
    })
    expect(resolveWelcomeEmailCopy('en')).toEqual({
      subject: 'Welcome {{userName}}',
      body: '<p>Hi {{userName}}</p>',
      locale: 'en',
    })
  })

  it('the signup route never inserts the copies as a user column', () => {
    expect(signup).toContain('"localizedTemplates":1')
  })
})

describe('invoice email', () => {
  const delivery: UIDLInvoiceEmailDelivery = {
    enabled: true,
    provider: 'resend',
    fromEmail: 'billing@example.com',
    fromName: 'Billing',
    subject: 'Invoice {{invoiceNumber}}',
    body: '<p>Invoice {{invoiceNumber}}</p>',
    secretKeys: {},
    localizedTemplates: {
      es: { subject: 'Factura {{invoiceNumber}}', body: '<p>Factura {{invoiceNumber}}</p>' },
    },
  }

  it('the sender picks the copy of the invoice locale', () => {
    const sender = generateEmailSenderCode(delivery)
    expect(sender).toContain("var emailLocale = require('../email/email-locale');")
    expect(sender).toContain(
      `var LOCALIZED_TEMPLATES = ${JSON.stringify(delivery.localizedTemplates)};`
    )

    const locale = loadLocaleModule()
    const buildEmailData = extractFunctionSource(sender, 'function buildEmailData(')
    const pdfGenerator = {
      buildDataContext: (data: { invoiceNumber: string }) => ({
        invoiceNumber: data.invoiceNumber,
      }),
    }
    const replacePlaceholders = (template: string, data: Record<string, string>) =>
      template.replace(/\{\{(\w+)\}\}/g, (_m, key) => data[key] || '')
    // eslint-disable-next-line no-new-func
    const build = new Function(
      'emailLocale',
      'pdfGenerator',
      'replacePlaceholders',
      'SUBJECT_TEMPLATE',
      'BODY_TEMPLATE',
      'LOCALIZED_TEMPLATES',
      `${buildEmailData}; return buildEmailData;`
    )(
      locale,
      pdfGenerator,
      replacePlaceholders,
      delivery.subject,
      delivery.body,
      delivery.localizedTemplates
    )
    expect(build({ invoiceNumber: 'INV-7', locale: 'es', customerEmail: 'a@b.c' })).toMatchObject({
      subject: 'Factura INV-7',
      body: '<p>Factura INV-7</p>',
    })
    expect(build({ invoiceNumber: 'INV-7', customerEmail: 'a@b.c' })).toMatchObject({
      subject: 'Invoice INV-7',
      body: '<p>Invoice INV-7</p>',
    })
  })

  it('the generate route resolves the locale: order row, then caller, then request', () => {
    const settings = {
      invoicePrefix: 'INV-',
      defaultTaxRate: 0,
      showDiscount: false,
      template: { document: null as unknown },
      tables: { invoicesTable: 'teleport_invoices', invoiceItemsTable: 'teleport_invoice_items' },
      emailDelivery: delivery,
    } as unknown as UIDLInvoiceSettings
    const route = generateInvoiceGenerateRouteCode(settings)
    expect(route).toContain("var emailLocale = require('../../../utils/email/email-locale');")
    expect(route).toContain('var invoiceLocale = emailLocale.normalizeEmailLocale(orderRow.locale)')
    expect(route).toContain('|| emailLocale.normalizeEmailLocale(body.locale)')
    expect(route).toContain('|| emailLocale.resolveRequestLocale(req);')
    expect(route).toContain('locale: invoiceLocale,')
  })

  it('a project without email delivery needs no locale module', () => {
    const route = generateInvoiceGenerateRouteCode({
      invoicePrefix: 'INV-',
      emailDelivery: { enabled: false },
    } as unknown as UIDLInvoiceSettings)
    expect(route).not.toContain('email-locale')
    expect(route).not.toContain('invoiceLocale')
  })

  it('the generate-invoice node forwards the run locale as a hint', () => {
    const source = nodeRegistry['ecommerce-generate-invoice'].generateHandler()
    expect(source).toContain('payload.locale = runLocale')
  })
})

describe('data-api stamps the storefront language on an order', () => {
  const code = generateDataAPIRoute()
  const stamp = extractFunctionSource(code, 'function stampRequestLocale(')
  // eslint-disable-next-line no-new-func
  const stampRequestLocale = new Function(
    'LOCALE_STAMPED_TABLES',
    'LOCALE_COLUMN',
    `${stamp}; return stampRequestLocale;`
  )({ teleport_orders: 1 }, 'locale')

  it('adds the locale to an orders insert when the table has the column', () => {
    const entries = [['status', 'pending']]
    expect(
      stampRequestLocale('teleport_orders', entries, { locale: 'character varying' }, 'es')
    ).toEqual([
      ['status', 'pending'],
      ['locale', 'es'],
    ])
  })

  it('leaves the insert alone when the column, the locale or the table does not apply', () => {
    const entries = [['status', 'pending']]
    expect(stampRequestLocale('teleport_orders', entries, {}, 'es')).toBe(entries)
    expect(stampRequestLocale('teleport_orders', entries, { locale: 'text' }, '')).toBe(entries)
    expect(stampRequestLocale('teleport_products', entries, { locale: 'text' }, 'es')).toBe(entries)
  })

  it('never overrides a locale the workflow mapped itself', () => {
    const entries = [['locale', 'fr']]
    expect(stampRequestLocale('teleport_orders', entries, { locale: 'text' }, 'es')).toBe(entries)
  })

  it('is wired into handleCreate from the request body', () => {
    expect(code).toContain(
      'entries = stampRequestLocale(tableName, entries, colTypes, body.__requestLocale);'
    )
    expect(nodeRegistry['data-create-item'].generateHandler()).toContain(
      'reqBody.__requestLocale = __runLocale'
    )
  })
})
