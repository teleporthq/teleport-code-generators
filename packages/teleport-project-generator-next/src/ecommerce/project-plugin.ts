import {
  FileType,
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLEcommerceSettings,
  UIDLInvoiceSettings,
} from '@teleporthq/teleport-types'
import { generateEcommerceContextFileContent } from './ecommerce-context-generator'
import {
  generateCheckoutApiRoute,
  generateStockCheckApiRoute,
  generateStoreLocationsApiRoute,
  generateDeliveryPriceApiRoute,
  generateOrderNotificationApiRoute,
  generateLowStockAlertApiRoute,
  generateEcommerceSettingsApiRoute,
  generatePaypalCaptureApiRoute,
} from './ecommerce-api-routes-generator'
import { generateEmailSenderModule } from './email-sender-generator'
import { generateCartApiRoute } from './cart-api-routes-generator'

export class NextEcommerceProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files, dependencies } = structure
    const ecommerceSettings = uidl.ecommerceSettings
    if (!ecommerceSettings) {
      // A component can reference the ecommerce/cart hook — the i18n locale
      // mapper injects `import { useEcommerce } from '@/ecommerce-context'` for
      // cart-bound nodes (e.g. a nav cart counter) — even when the project
      // carries no `ecommerceSettings`. Without the context file those imports
      // dangle and `next build` fails with "Module not found: Can't resolve
      // '@/ecommerce-context'". Emit a localStorage-only context (no payment
      // providers / delivery) and wrap _app, so the references resolve and a
      // basic cart still works. Projects that never reference it are untouched.
      if (projectReferencesEcommerceContext(files)) {
        this.generateContextFile({} as UIDLEcommerceSettings, undefined, files, null, false)
        this.injectProviderIntoApp(files)
      }
      return structure
    }

    const { dataSourceType, dataSourceConfig, dataSourceId } = this.resolveDataSource(structure)

    // The DB-backed cart route only generates for Postgres datasources;
    // when it does, the provider layers DB sync on top of localStorage.
    const cartRoute = generateCartApiRoute(dataSourceType, dataSourceConfig)
    const cartDbEnabled = cartRoute !== null

    this.generateContextFile(
      ecommerceSettings,
      uidl.invoiceSettings,
      files,
      dataSourceId,
      cartDbEnabled
    )
    this.generateApiRoutes(ecommerceSettings, dataSourceType, dataSourceConfig, files)
    if (cartRoute) {
      files.set('ecommerce-api-cart', {
        path: ['pages', 'api', 'cart'],
        files: [
          {
            name: '[op]',
            fileType: FileType.JS,
            content: cartRoute,
          },
        ],
      })
    }
    this.addDependencies(ecommerceSettings, dependencies)
    this.addEnvVars(ecommerceSettings, uidl)
    this.injectProviderIntoApp(files)

    return structure
  }

  private resolveDataSource(structure: ProjectPluginStructure): {
    dataSourceType: string | null
    dataSourceConfig: Record<string, unknown> | null
    dataSourceId: string | null
  } {
    const { uidl } = structure

    if (uidl.authentication?.dataSourceId && uidl.dataSources) {
      const ds = uidl.dataSources[uidl.authentication.dataSourceId]
      if (ds) {
        return {
          dataSourceType: ds.type,
          dataSourceConfig: ds.config,
          dataSourceId: uidl.authentication.dataSourceId,
        }
      }
    }

    if (uidl.dataSources) {
      const ids = Object.keys(uidl.dataSources)
      if (ids.length > 0) {
        return {
          dataSourceType: uidl.dataSources[ids[0]].type,
          dataSourceConfig: uidl.dataSources[ids[0]].config,
          dataSourceId: ids[0],
        }
      }
    }

    return { dataSourceType: null, dataSourceConfig: null, dataSourceId: null }
  }

  private generateContextFile(
    ecommerceSettings: UIDLEcommerceSettings,
    invoiceSettings: UIDLInvoiceSettings | undefined,
    files: Map<string, any>,
    dataSourceId: string | null,
    cartDbEnabled: boolean
  ): void {
    const content = generateEcommerceContextFileContent(
      ecommerceSettings,
      invoiceSettings,
      dataSourceId,
      cartDbEnabled
    )
    files.set('ecommerce-context', {
      path: [],
      files: [
        {
          name: 'ecommerce-context',
          fileType: FileType.JS,
          content,
        },
      ],
    })
  }

  private generateApiRoutes(
    settings: UIDLEcommerceSettings,
    dataSourceType: string | null,
    dataSourceConfig: Record<string, unknown> | null,
    files: Map<string, any>
  ): void {
    files.set('ecommerce-api-settings', {
      path: ['pages', 'api', 'ecommerce'],
      files: [
        {
          name: 'settings',
          fileType: FileType.JS,
          content: generateEcommerceSettingsApiRoute(settings),
        },
      ],
    })

    files.set('ecommerce-api-checkout', {
      path: ['pages', 'api', 'ecommerce'],
      files: [
        {
          name: 'checkout',
          fileType: FileType.JS,
          content: generateCheckoutApiRoute(settings, dataSourceType, dataSourceConfig),
        },
      ],
    })

    if (settings.stockManagement) {
      files.set('ecommerce-api-stock-check', {
        path: ['pages', 'api', 'ecommerce'],
        files: [
          {
            name: 'stock-check',
            fileType: FileType.JS,
            content: generateStockCheckApiRoute(settings, dataSourceType, dataSourceConfig),
          },
        ],
      })
    }

    if (settings.storePickupEnabled) {
      files.set('ecommerce-api-store-locations', {
        path: ['pages', 'api', 'ecommerce'],
        files: [
          {
            name: 'store-locations',
            fileType: FileType.JS,
            content: generateStoreLocationsApiRoute(dataSourceType, dataSourceConfig),
          },
        ],
      })
    }

    // PayPal capture endpoint — only emitted when the project actually
    // offers PayPal. PayPal Orders v2 with `intent: 'CAPTURE'` requires the
    // merchant to explicitly capture the order after the buyer approves;
    // skipping this call leaves orders in `APPROVED` state and PayPal
    // never fires the corresponding `PAYMENT.CAPTURE.*` webhooks.
    const hasPaypal = (settings.paymentProviders || []).some(
      (p) => p && (p.type === 'paypal' || p.name === 'PayPal')
    )
    if (hasPaypal) {
      files.set('ecommerce-api-paypal-capture', {
        path: ['pages', 'api', 'ecommerce', 'paypal'],
        files: [
          {
            name: 'capture',
            fileType: FileType.JS,
            content: generatePaypalCaptureApiRoute(),
          },
        ],
      })
    }

    if (settings.deliveryEnabled && settings.deliveryConfig) {
      files.set('ecommerce-api-delivery-price', {
        path: ['pages', 'api', 'ecommerce'],
        files: [
          {
            name: 'delivery-price',
            fileType: FileType.JS,
            content: generateDeliveryPriceApiRoute(settings),
          },
        ],
      })
    }

    if (settings.orderNotifications && settings.orderNotificationConfig) {
      files.set('ecommerce-api-order-notification', {
        path: ['pages', 'api', 'ecommerce'],
        files: [
          {
            name: 'order-notification',
            fileType: FileType.JS,
            content: generateOrderNotificationApiRoute(settings),
          },
        ],
      })
    }

    // Low-stock alerts: only emit the endpoint AND the shared sender
    // when the merchant turned the feature on AND configured templates.
    // Skipping the route entirely (rather than emitting a 200-no-op
    // version) keeps the data-api's fire-and-forget POST cheap — it
    // short-circuits on LOW_STOCK_ALERTS_ENABLED=false before touching
    // the network at all.
    const stockAlertsActive = !!(
      settings.stockManagement &&
      settings.stockManagementConfig?.lowStockAlerts &&
      settings.stockManagementConfig?.lowStockAlertConfig?.provider
    )
    if (stockAlertsActive) {
      files.set('ecommerce-api-low-stock-alert', {
        path: ['pages', 'api', 'ecommerce'],
        files: [
          {
            name: 'low-stock-alert',
            fileType: FileType.JS,
            content: generateLowStockAlertApiRoute(settings),
          },
        ],
      })
    }

    // Shared email-sender module — consumed by order-notification and
    // low-stock-alert endpoints. Emitted whenever EITHER consumer is
    // active so the require() in those endpoints resolves at runtime.
    const orderNotifActive = !!(
      settings.orderNotifications && settings.orderNotificationConfig?.provider
    )
    if (orderNotifActive || stockAlertsActive) {
      files.set('ecommerce-email-sender', {
        path: ['utils', 'ecommerce'],
        files: [
          {
            name: 'email-sender',
            fileType: FileType.JS,
            content: generateEmailSenderModule(settings, { logTag: 'email-sender' }),
          },
        ],
      })
    }
  }

  private addDependencies(
    settings: UIDLEcommerceSettings,
    dependencies: Record<string, string>
  ): void {
    const paymentProviders = settings.paymentProviders || []
    const providerTypes = paymentProviders.map((p) => p.type)

    if (providerTypes.includes('stripe')) {
      dependencies.stripe = '^14.0.0'
    }

    // Walk EVERY consumer of the shared email-sender — order
    // notifications today, low-stock alerts today, anything else
    // tomorrow. The first non-empty provider wins (the sender
    // module collapses them into a single provider switch). This
    // matches the merchant's typical "one transactional provider
    // per project" setup and keeps the dependency list minimal.
    const emailProviders = [
      settings.orderNotifications && settings.orderNotificationConfig?.provider,
      settings.stockManagement &&
        settings.stockManagementConfig?.lowStockAlerts &&
        settings.stockManagementConfig?.lowStockAlertConfig?.provider,
    ].filter(Boolean) as string[]
    if (emailProviders.length > 0) {
      const provider = emailProviders[0]
      switch (provider) {
        case 'sendgrid':
          dependencies['@sendgrid/mail'] = '^8.0.0'
          break
        case 'resend':
          dependencies.resend = '^2.0.0'
          break
        case 'postmark':
          // Postmark goes through the email-sender's direct HTTPS
          // implementation — no npm dependency. The fetch polyfill
          // pulls node-fetch only on Node runtimes that lack a
          // native fetch (Node < 18); production typically runs on
          // newer Node so this is rarely loaded.
          dependencies['node-fetch'] = '^2.7.0'
          break
        case 'mailgun':
        case 'mailersend':
        default:
          // SMTP fallback covers anything we don't explicitly
          // recognise. Same nodemailer version as before.
          dependencies.nodemailer = '^7.0.7'
          break
      }
    }
  }

  private addEnvVars(settings: UIDLEcommerceSettings, uidl: ProjectPluginStructure['uidl']): void {
    if (!uidl.globals.env) {
      uidl.globals.env = {}
    }

    const paymentProviders = settings.paymentProviders || []
    const providerTypes = paymentProviders.map((p) => p.type)

    if (providerTypes.includes('stripe')) {
      if (!uidl.globals.env.STRIPE_SECRET_KEY) {
        uidl.globals.env.STRIPE_SECRET_KEY = ''
      }
      if (!uidl.globals.env.STRIPE_WEBHOOK_SECRET) {
        uidl.globals.env.STRIPE_WEBHOOK_SECRET = ''
      }
    }

    if (providerTypes.includes('paypal')) {
      if (!uidl.globals.env.PAYPAL_CLIENT_ID) {
        uidl.globals.env.PAYPAL_CLIENT_ID = ''
      }
      if (!uidl.globals.env.PAYPAL_CLIENT_SECRET) {
        uidl.globals.env.PAYPAL_CLIENT_SECRET = ''
      }
    }

    // Same provider-aggregation as addDependencies — see the
    // comment there. The env var only matters when SOMEONE is
    // going to dispatch an email; both consumers funnel through
    // the same env vars because they share the sender module.
    const emailProvider =
      (settings.orderNotifications && settings.orderNotificationConfig?.provider) ||
      (settings.stockManagement &&
        settings.stockManagementConfig?.lowStockAlerts &&
        settings.stockManagementConfig?.lowStockAlertConfig?.provider) ||
      null
    if (emailProvider) {
      switch (emailProvider) {
        case 'sendgrid':
          if (!uidl.globals.env.SENDGRID_API_KEY) {
            uidl.globals.env.SENDGRID_API_KEY = ''
          }
          break
        case 'resend':
          if (!uidl.globals.env.RESEND_API_KEY) {
            uidl.globals.env.RESEND_API_KEY = ''
          }
          break
        case 'postmark':
          if (!uidl.globals.env.POSTMARK_SERVER_TOKEN) {
            uidl.globals.env.POSTMARK_SERVER_TOKEN = ''
          }
          // MessageStream defaults to 'outbound' in the sender; the
          // env var lets a merchant pin a different stream without
          // re-exporting the project.
          if (!uidl.globals.env.POSTMARK_MESSAGE_STREAM) {
            uidl.globals.env.POSTMARK_MESSAGE_STREAM = 'outbound'
          }
          break
        default:
          if (!uidl.globals.env.SMTP_HOST) {
            uidl.globals.env.SMTP_HOST = ''
          }
          if (!uidl.globals.env.SMTP_PORT) {
            uidl.globals.env.SMTP_PORT = '587'
          }
          if (!uidl.globals.env.SMTP_USER) {
            uidl.globals.env.SMTP_USER = ''
          }
          if (!uidl.globals.env.SMTP_PASS) {
            uidl.globals.env.SMTP_PASS = ''
          }
          break
      }

      const fromCandidate =
        settings.orderNotificationConfig?.fromEmail ||
        settings.stockManagementConfig?.lowStockAlertConfig?.fromEmail ||
        ''
      if (!uidl.globals.env.ORDER_NOTIFICATION_FROM_EMAIL) {
        uidl.globals.env.ORDER_NOTIFICATION_FROM_EMAIL = fromCandidate
      }
    }
  }

  private injectProviderIntoApp(files: Map<string, any>): void {
    let appFile: any = null

    for (const [key, record] of Array.from(files.entries())) {
      if (key === '_app' || key.includes('_app')) {
        appFile = record.files?.find(
          (f: any) => f.name === '_app' && (f.fileType === 'js' || f.fileType === 'tsx')
        )
        if (appFile) {
          break
        }
      }
    }

    if (!appFile || typeof appFile.content !== 'string') {
      return
    }
    if (appFile.content.includes('EcommerceProvider')) {
      return
    }

    let content = appFile.content

    const importStatement = `import { EcommerceProvider } from '../ecommerce-context';\n`
    const firstImportIdx = content.indexOf('import ')
    if (firstImportIdx >= 0) {
      content = content.slice(0, firstImportIdx) + importStatement + content.slice(firstImportIdx)
    } else {
      content = importStatement + content
    }

    const returnMatch = content.match(/return\s*\(\s*/)
    if (returnMatch && returnMatch.index !== undefined) {
      const afterReturn = returnMatch.index + returnMatch[0].length
      const restContent = content.slice(afterReturn)
      const closingParenIdx = findMatchingClosingParen(restContent)
      if (closingParenIdx >= 0) {
        const innerJSX = restContent.slice(0, closingParenIdx)
        const afterClosing = restContent.slice(closingParenIdx)
        content =
          content.slice(0, afterReturn) +
          `<EcommerceProvider>${innerJSX}</EcommerceProvider>` +
          afterClosing
      }
    }

    appFile.content = content
  }
}

// True when any already-generated file imports the local `@/ecommerce-context`
// module. Used to decide whether a settings-less project still needs the
// context file emitted (so injected cart-hook imports don't dangle).
function projectReferencesEcommerceContext(files: Map<string, any>): boolean {
  for (const [, record] of Array.from(files.entries())) {
    for (const file of record.files || []) {
      if (typeof file.content === 'string' && file.content.includes('@/ecommerce-context')) {
        return true
      }
    }
  }
  return false
}

function findMatchingClosingParen(str: string): number {
  let depth = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '(') {
      depth++
    }
    if (ch === ')') {
      if (depth === 0) {
        return i
      }
      depth--
    }
  }
  return -1
}
