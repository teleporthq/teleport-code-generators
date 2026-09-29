import { EmailLocaleConfig, generateEmailLocaleModuleCode } from '../../src/email-locale'
import { generateSignedInDestinationCode } from '../../src/auth-return/signed-in-destination-code'
import { WORKFLOW_UTILS_ALIAS } from '../../src/workflow-utils-alias'

// A node handler evaluated on its own has no generated file around it to bind
// `__workflowUtils` (see workflow-utils-alias.ts), so a test that RUNS such a
// handler binds it here — to the real generated locale helpers, so the
// behaviour under test is the one a generated project ships.

export const TEST_LOCALES: EmailLocaleConfig = { locales: ['en', 'es'], defaultLocale: 'en' }

export const loadEmailLocaleModule = (
  config: EmailLocaleConfig = TEST_LOCALES
): Record<string, unknown> => {
  const moduleShim = { exports: {} as Record<string, unknown> }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', generateEmailLocaleModuleCode(config))(
    moduleShim,
    moduleShim.exports
  )
  return moduleShim.exports
}

/**
 * The runtime's `signedInDestination`, over the given `localizeHref`. It reads
 * `window` when called, so a test can install its browser stub afterwards.
 */
const loadSignedInDestination = (localizeHref: unknown): unknown =>
  // eslint-disable-next-line no-new-func
  new Function('localizeHref', `${generateSignedInDestinationCode()}\nreturn signedInDestination`)(
    localizeHref
  )

/** Binds the alias on the global scope; returns the function that unbinds it. */
export const bindWorkflowUtils = (config: EmailLocaleConfig = TEST_LOCALES): (() => void) => {
  const globalRef = global as unknown as Record<string, unknown>
  const localeHelpers = loadEmailLocaleModule(config)
  globalRef[WORKFLOW_UTILS_ALIAS] = {
    ...localeHelpers,
    signedInDestination: loadSignedInDestination(localeHelpers.localizeHref),
  }
  return () => {
    delete globalRef[WORKFLOW_UTILS_ALIAS]
  }
}
