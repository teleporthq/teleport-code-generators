import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_add_class(config: any, context: Record<string, unknown>) {
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
      el.classList.add(className[i])
    }
  } else {
    el.classList.add(className)
  }

  return { success: true }
}
export const elementAddClass: NodeHandlerGenerator = {
  nodeType: 'element-add-class',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_add_class)
  },
}
