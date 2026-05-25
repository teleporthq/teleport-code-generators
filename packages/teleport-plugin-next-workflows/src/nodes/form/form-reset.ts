import { NodeHandlerGenerator, handlerToString } from '../types'

async function form_reset(config: any, context: Record<string, unknown>) {
  const formNodeId = config.formNodeId

  const el =
    document.getElementById(formNodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { success: false }
  }

  if (typeof (el as HTMLFormElement).reset === 'function') {
    ;(el as HTMLFormElement).reset()
  }

  return { success: true }
}
export const formReset: NodeHandlerGenerator = {
  nodeType: 'form-reset',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(form_reset)
  },
}
