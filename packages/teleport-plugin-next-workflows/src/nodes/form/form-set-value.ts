import { NodeHandlerGenerator, handlerToString } from '../types'

async function form_set_value(config: any, context: Record<string, unknown>) {
  const nodeId = config.nodeId
  const value = config.value

  const el =
    document.getElementById(nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { success: false }
  }

  ;(el as HTMLInputElement).value = value

  const event = new Event('input', { bubbles: true })
  el.dispatchEvent(event)

  return { success: true }
}
export const formSetValue: NodeHandlerGenerator = {
  nodeType: 'form-set-value',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(form_set_value)
  },
}
