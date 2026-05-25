import { NodeHandlerGenerator, handlerToString } from '../types'

async function general_trigger_download(config: any, context: Record<string, unknown>) {
  const url = config.url
  const filename = config.filename || ''

  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const generalTriggerDownload: NodeHandlerGenerator = {
  nodeType: 'general-trigger-download',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(general_trigger_download)
  },
}
