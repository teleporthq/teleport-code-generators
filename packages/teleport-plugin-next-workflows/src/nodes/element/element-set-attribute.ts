import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_set_attribute(config: any, context: Record<string, unknown>) {
  const nodeId = config.nodeId
  const attribute = config.attribute
  const value = config.value

  const el =
    document.getElementById(nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { success: false }
  }

  el.setAttribute(attribute, value)

  return { success: true }
}
export const elementSetAttribute: NodeHandlerGenerator = {
  nodeType: 'element-set-attribute',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_set_attribute)
  },
}
