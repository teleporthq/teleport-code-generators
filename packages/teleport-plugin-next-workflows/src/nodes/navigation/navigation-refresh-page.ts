import { NodeHandlerGenerator, handlerToString } from '../types'

async function navigation_refresh_page(config: any, context: Record<string, unknown>) {
  window.location.reload()
  return { __terminal: true }
}
export const navigationRefreshPage: NodeHandlerGenerator = {
  nodeType: 'navigation-refresh-page',
  executionEnv: 'client',
  isTerminal: true,
  generateHandler(): string {
    return handlerToString(navigation_refresh_page)
  },
}
