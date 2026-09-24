import { NodeHandlerGenerator, handlerToString } from '../types'

async function navigation_navigate_to_url(config: any, context: Record<string, unknown>) {
  const openInNewTab = config.openInNewTab

  if (!config.url) {
    return { __terminal: true }
  }

  // A site-relative page path stays in the language the visitor is browsing in
  // (see buildContext for how the run learns it); an external URL, an API
  // route or a file passes through untouched.
  const url = __workflowUtils.localizeHref(config.url, context && (context as any).__locale)

  if (openInNewTab) {
    window.open(url, '_blank')
  } else {
    window.location.href = url
  }

  return { __terminal: true }
}
export const navigationNavigateToUrl: NodeHandlerGenerator = {
  nodeType: 'navigation-navigate-to-url',
  executionEnv: 'client',
  isTerminal: true,
  generateHandler(): string {
    return handlerToString(navigation_navigate_to_url)
  },
}
