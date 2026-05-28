import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_remove_class(config: any, context: Record<string, unknown>) {
  const nodeId = config.nodeId
  const className = config.className

  const el =
    document.getElementById(nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { success: false }
  }

  if (Array.isArray(className)) {
    for (let i = 0; i < className.length; i++) {
      el.classList.remove(className[i])
    }
  } else {
    el.classList.remove(className)
  }

  return { success: true }
}
export const elementRemoveClass: NodeHandlerGenerator = {
  nodeType: 'element-remove-class',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_remove_class)
  },
}
