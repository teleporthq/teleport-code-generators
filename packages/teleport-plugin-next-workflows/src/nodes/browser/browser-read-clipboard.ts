import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_read_clipboard() {
  try {
    if (!navigator.clipboard?.readText) {
      return { text: '', error: 'Clipboard API is not supported' }
    }
    const text = await navigator.clipboard.readText()
    return { text }
  } catch (err: unknown) {
    return { text: '', error: (err as Error).message }
  }
}
export const browserReadClipboard: NodeHandlerGenerator = {
  nodeType: 'browser-read-clipboard',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_read_clipboard)
  },
}
