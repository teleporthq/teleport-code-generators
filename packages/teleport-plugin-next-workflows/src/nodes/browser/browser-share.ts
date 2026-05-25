import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_share(config: any) {
  const title = config.title || ''
  const text = config.text || ''
  const url = config.url || ''

  try {
    if (!navigator.share) {
      return { success: false, error: 'Web Share API is not supported' }
    }

    const shareData: ShareData = {}
    if (title) {
      shareData.title = title
    }
    if (text) {
      shareData.text = text
    }
    if (url) {
      shareData.url = url
    }

    await navigator.share(shareData)
    return { success: true }
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError') {
      return { success: false, error: 'Share was cancelled' }
    }
    return { success: false, error: (err as Error).message }
  }
}
export const browserShare: NodeHandlerGenerator = {
  nodeType: 'browser-share',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_share)
  },
}
