import { NodeHandlerGenerator, handlerToString } from '../types'

async function form_focus(config: any, context: Record<string, unknown>) {
  const nodeId = config.nodeId

  const el =
    document.getElementById(nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { success: false }
  }

  el.focus()

  return { success: true }
}
export const formFocus: NodeHandlerGenerator = {
  nodeType: 'form-focus',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(form_focus)
  },
}
