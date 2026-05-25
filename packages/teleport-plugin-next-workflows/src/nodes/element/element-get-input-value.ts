import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_get_input_value(config: any, context: Record<string, unknown>) {
  const nodeId = config.nodeId

  const el =
    document.getElementById(nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { value: '' }
  }

  return { value: (el as HTMLInputElement).value || '' }
}
export const elementGetInputValue: NodeHandlerGenerator = {
  nodeType: 'element-get-input-value',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_get_input_value)
  },
}
