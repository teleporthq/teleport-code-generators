import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_set_text(config: any, context: Record<string, unknown>) {
  const nodeId = config.nodeId
  const text = config.text || ''
  const useInnerHTML = config.useInnerHTML

  const el =
    document.getElementById(nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { success: false }
  }

  if (useInnerHTML) {
    el.innerHTML = text
  } else {
    el.textContent = text
  }

  return { success: true }
}
export const elementSetText: NodeHandlerGenerator = {
  nodeType: 'element-set-text',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_set_text)
  },
}
