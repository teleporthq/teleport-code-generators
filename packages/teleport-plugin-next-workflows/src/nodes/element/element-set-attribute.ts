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

  // setAttribute throws an InvalidCharacterError DOMException on an empty or
  // syntactically invalid attribute name — guard so the node can never throw.
  if (!attribute || typeof attribute !== 'string') {
    return { success: false }
  }
  try {
    el.setAttribute(attribute, value)
  } catch (e) {
    return { success: false }
  }

  return { success: true }
}
export const elementSetAttribute: NodeHandlerGenerator = {
  nodeType: 'element-set-attribute',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_set_attribute)
  },
}
