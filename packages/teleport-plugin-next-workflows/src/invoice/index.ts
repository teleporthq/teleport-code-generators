import {
  ProjectPluginStructure,
  FileType,
  UIDLInvoiceSettings,
  DataSourceType,
} from '@teleporthq/teleport-types'
import { generatePdfGeneratorCode } from './pdf-generator-code'
import { generateEmailSenderCode, getEmailProviderDependencies } from './email-sender-code'
import { generateDataAccessCode, getRecordMappingCode } from './data-access-code'
import { generateInvoiceGenerateRouteCode, generateInvoicePdfRouteCode } from './api-routes-code'
import { getDatabaseDriverDependencies } from '../auth-generator'
import { ensureSentEmailLogModule } from '../sent-email-log'

export const generateInvoiceFiles = (
  invoiceSettings: UIDLInvoiceSettings,
  structure: ProjectPluginStructure,
  dataSourceType: DataSourceType | null,
  dataSourceConfig: Record<string, unknown> | null
): void => {
  const { files, dependencies } = structure

  const dataAccessCode =
    generateDataAccessCode(invoiceSettings, dataSourceType, dataSourceConfig) +
    '\n' +
    getRecordMappingCode(dataSourceType || undefined)

  files.set('invoice-data-access', {
    path: ['utils', 'invoices'],
    files: [
      {
        name: 'data-access',
        fileType: FileType.JS,
        content: dataAccessCode,
      },
    ],
  })

  // Resolve the user-authored invoice-template component so the PDF
  // renderer walks THAT exact UIDL tree (styles, <context> scope,
  // cms-list-repeater, default static data — everything the GUI editor
  // saves). Name-keyed lookup matches how other plugins access components
  // (see e.g. rich-text-editor/project-plugin.ts). The `templateComponentId`
  // stored in invoiceSettings is a separate editor handle and is not used
  // to key the components map in the UIDL.
  const invoiceTemplateUidl =
    (structure.uidl.components && structure.uidl.components['invoice-template']) || null

  // The PDF generator resolves `elementType: 'component'` references
  // (e.g. the company Logo embedded in the invoice-template) at render
  // time by looking up the target component's UIDL node. Pass the
  // entire project components map through so the emitter can compute
  // the transitive closure of reachable components at generation time.
  const allComponents = (structure.uidl.components || {}) as unknown as Record<string, unknown>
  const pdfGeneratorCode = generatePdfGeneratorCode(
    invoiceSettings,
    invoiceTemplateUidl,
    allComponents
  )
  files.set('invoice-pdf-generator', {
    path: ['utils', 'invoices'],
    files: [
      {
        name: 'pdf-generator',
        fileType: FileType.JS,
        content: pdfGeneratorCode,
      },
    ],
  })

  if (invoiceSettings.emailDelivery?.enabled) {
    // The sender records every attempt in the sent-email ledger.
    ensureSentEmailLogModule(structure)
    const emailSenderCode = generateEmailSenderCode(invoiceSettings.emailDelivery)
    files.set('invoice-email-sender', {
      path: ['utils', 'invoices'],
      files: [
        {
          name: 'email-sender',
          fileType: FileType.JS,
          content: emailSenderCode,
        },
      ],
    })

    const emailDeps = getEmailProviderDependencies(invoiceSettings.emailDelivery.provider)
    for (const [pkg, version] of Object.entries(emailDeps)) {
      if (!dependencies[pkg]) {
        dependencies[pkg] = version
      }
    }

    if (invoiceSettings.emailDelivery.secretKeys) {
      const uidl = structure.uidl
      if (!uidl.globals) {
        ;(uidl as any).globals = { settings: { language: 'en' }, assets: [], env: {} }
      }
      if (!uidl.globals.env) {
        uidl.globals.env = {}
      }
      for (const [, secretName] of Object.entries(invoiceSettings.emailDelivery.secretKeys)) {
        if (secretName && !uidl.globals.env[secretName]) {
          uidl.globals.env[secretName] = ''
        }
      }
    }
  }

  const generateRouteCode = generateInvoiceGenerateRouteCode(invoiceSettings)
  files.set('invoice-generate-route', {
    path: ['pages', 'api', 'invoices'],
    files: [
      {
        name: 'generate',
        fileType: FileType.JS,
        content: generateRouteCode,
      },
    ],
  })

  const pdfRouteCode = generateInvoicePdfRouteCode()
  files.set('invoice-pdf-route', {
    path: ['pages', 'api', 'invoices', '[id]'],
    files: [
      {
        name: 'pdf',
        fileType: FileType.JS,
        content: pdfRouteCode,
      },
    ],
  })

  // The emitted pdf-generator.js delegates rendering to a shared
  // external microservice (see PDF_SERVICE_SPEC.md at the workspace
  // root) instead of launching Chromium in-process. No puppeteer-core
  // or @sparticuz/chromium in the generated bundle — that saved ~48 MB
  // and the associated cold-start + memory cost on every deployment.
  // Env wiring: `PDF_SERVICE_URL` and `PDF_SERVICE_API_KEY` are
  // registered below and populated by the services-worker Vercel
  // controller at deploy time.
  const pdfEnvUidl = structure.uidl
  if (!pdfEnvUidl.globals) {
    ;(pdfEnvUidl as any).globals = { settings: { language: 'en' }, assets: [], env: {} }
  }
  if (!pdfEnvUidl.globals.env) {
    pdfEnvUidl.globals.env = {}
  }
  if (!pdfEnvUidl.globals.env.PDF_SERVICE_URL) {
    pdfEnvUidl.globals.env.PDF_SERVICE_URL = ''
  }
  if (!pdfEnvUidl.globals.env.PDF_SERVICE_API_KEY) {
    pdfEnvUidl.globals.env.PDF_SERVICE_API_KEY = ''
  }

  const dbDeps = getDatabaseDriverDependencies(dataSourceType)
  for (const [pkg, version] of Object.entries(dbDeps)) {
    if (!dependencies[pkg]) {
      dependencies[pkg] = version
    }
  }
}

export { resolveInvoiceDataSource } from './resolve-data-source'
