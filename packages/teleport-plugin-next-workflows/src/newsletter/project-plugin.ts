import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { getDatabaseDriverDependencies } from '../auth-generator'
import { hasAutomationsBus } from '../automations/automations-scope'
import { ensureEmailLocaleModule } from '../email-locale'
import { collectWorkflowNodeConfigs } from '../password-reset-route-generator'
import { ensureSecurityRuntimeModule } from '../security-runtime'
import { ensureSentEmailLogModule } from '../sent-email-log'
import {
  SUPPORTED_EMAIL_PROVIDERS,
  transactionalEmailDependencies,
} from '../transactional-email-code'
import { generateNewsletterHelperCode } from './helper-code'
import {
  NEWSLETTER_HELPER_FILE_KEY,
  NEWSLETTER_HELPER_FILE_NAME,
  NEWSLETTER_HELPER_PATH,
  NEWSLETTER_ROUTES_FILE_KEY,
  NEWSLETTER_ROUTES_PATH,
  readNewsletterSettings,
} from './newsletter-scope'
import {
  generateNewsletterConfirmRoute,
  generateNewsletterSubscribeRoute,
  generateNewsletterUnsubscribeRoute,
} from './routes-code'

/**
 * The newsletter's generated side (see newsletter-scope.ts): the helper
 * `utils/newsletter/newsletter.js` and the routes
 * `pages/api/newsletter/{subscribe,confirm,unsubscribe}.js`, with the modules
 * they require (the security runtime, the email locale, the sent-email log
 * when a provider sends) and the provider's and Postgres's packages.
 *
 * Only for a project that carries `newsletterSettings` on the TeleportHQ
 * database; every other project is left byte for byte as it was. Runs after
 * the workflow project plugin, whose routes (the sign-up route's consent box,
 * the `newsletter-subscribe` node) require the helper.
 */
export class NextNewsletterProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files, dependencies } = structure
    const settings = readNewsletterSettings(uidl)
    if (!settings) {
      return structure
    }

    ensureSecurityRuntimeModule(structure)
    ensureEmailLocaleModule(structure)
    const provider =
      settings.email &&
      settings.email.provider &&
      SUPPORTED_EMAIL_PROVIDERS.has(settings.email.provider)
        ? settings.email.provider
        : null
    const packages = {
      ...getDatabaseDriverDependencies('teleport'),
      ...transactionalEmailDependencies(provider),
    }
    for (const [pkg, version] of Object.entries(packages)) {
      if (!dependencies[pkg]) {
        dependencies[pkg] = version
      }
    }
    if (provider) {
      ensureSentEmailLogModule(structure)
    }

    files.set(NEWSLETTER_HELPER_FILE_KEY, {
      path: NEWSLETTER_HELPER_PATH,
      files: [
        {
          name: NEWSLETTER_HELPER_FILE_NAME,
          fileType: FileType.JS,
          content: generateNewsletterHelperCode({
            settings,
            siteName: uidl.name || '',
            withAutomations: hasAutomationsBus(uidl),
            signupSendsAccountWelcome: signupSendsAccountWelcome(uidl.workflows),
          }),
        },
      ],
    })

    files.set(NEWSLETTER_ROUTES_FILE_KEY, {
      path: NEWSLETTER_ROUTES_PATH,
      files: [
        { name: 'subscribe', fileType: FileType.JS, content: generateNewsletterSubscribeRoute() },
        { name: 'confirm', fileType: FileType.JS, content: generateNewsletterConfirmRoute() },
        {
          name: 'unsubscribe',
          fileType: FileType.JS,
          content: generateNewsletterUnsubscribeRoute(),
        },
      ],
    })

    // The published admin panel does not send. Scheduling is a row edit on the
    // site, then an unauthenticated hint. No service token is declared.
    return structure
  }
}

/**
 * Whether the sign-up route sends the account's welcome email: the project's
 * `account-signup` node names a provider and a body (the route bakes the same
 * first config, generateSignupRouteFile).
 */
const signupSendsAccountWelcome = (
  workflows: { workflows?: unknown; customNodes?: unknown } | undefined
): boolean => {
  const config = collectWorkflowNodeConfigs(workflows, 'account-signup')[0] || {}
  const nodeType = typeof config.emailProvider === 'string' ? config.emailProvider : ''
  const provider = nodeType.startsWith('email-') ? nodeType.slice('email-'.length) : ''
  return SUPPORTED_EMAIL_PROVIDERS.has(provider) && typeof config.body === 'string' && !!config.body
}
