import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_write_clipboard(config: any) {
  const text = config.text

  try {
    if (!navigator.clipboard?.writeText) {
      return { success: false, error: 'Clipboard API is not supported' }
    }
    await navigator.clipboard.writeText(text)
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const browserWriteClipboard: NodeHandlerGenerator = {
  nodeType: 'browser-write-clipboard',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_write_clipboard)
  },
}
