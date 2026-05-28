import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_print() {
  try {
    window.print()
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const browserPrint: NodeHandlerGenerator = {
  nodeType: 'browser-print',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_print)
  },
}
