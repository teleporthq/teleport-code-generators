import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_toggle_class(config: any, context: Record<string, unknown>) {
  const nodeId = config.nodeId
  const className = config.className
  const force = config.force

  const el =
    document.getElementById(nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { success: false }
  }

  if (force !== undefined) {
    el.classList.toggle(className, force)
  } else {
    el.classList.toggle(className)
  }

  return { success: true }
}
export const elementToggleClass: NodeHandlerGenerator = {
  nodeType: 'element-toggle-class',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_toggle_class)
  },
}
