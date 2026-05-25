import { NodeHandlerGenerator, handlerToString } from '../types'

async function navigation_navigate_to_url(config: any, context: Record<string, unknown>) {
  const url = config.url
  const openInNewTab = config.openInNewTab

  if (!url) {
    return { __terminal: true }
  }

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
