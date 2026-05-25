import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_hide(config: any, context: Record<string, unknown>) {
  const nodeId = config.nodeId
  const hideMethod = config.hideMethod || 'display'

  const el =
    document.getElementById(nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { success: false }
  }

  if (hideMethod === 'display') {
    el.style.display = 'none'
  } else if (hideMethod === 'visibility') {
    el.style.visibility = 'hidden'
  } else if (hideMethod === 'opacity') {
    el.style.opacity = '0'
  } else if (hideMethod === 'add-hidden') {
    el.setAttribute('hidden', '')
  } else {
    return { success: false, error: 'Unknown hideMethod: ' + hideMethod }
  }

  return { success: true }
}
export const elementHide: NodeHandlerGenerator = {
  nodeType: 'element-hide',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_hide)
  },
}
