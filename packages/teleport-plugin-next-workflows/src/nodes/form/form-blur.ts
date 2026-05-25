import { NodeHandlerGenerator, handlerToString } from '../types'

async function form_blur(config: any, context: Record<string, unknown>) {
  const nodeId = config.nodeId

  const el =
    document.getElementById(nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { success: false }
  }

  el.blur()

  return { success: true }
}
export const formBlur: NodeHandlerGenerator = {
  nodeType: 'form-blur',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(form_blur)
  },
}
