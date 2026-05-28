import { NodeHandlerGenerator, handlerToString } from '../types'

async function navigation_go_back(config: any, context: Record<string, unknown>) {
  window.history.back()
  return { __terminal: true }
}
export const navigationGoBack: NodeHandlerGenerator = {
  nodeType: 'navigation-go-back',
  executionEnv: 'client',
  isTerminal: true,
  generateHandler(): string {
    return handlerToString(navigation_go_back)
  },
}
