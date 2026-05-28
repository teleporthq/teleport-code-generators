import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_show(config: any, context: Record<string, unknown>) {
  const nodeId = config.nodeId
  const showMethod = config.showMethod || 'display'

  const el =
    document.getElementById(nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { success: false }
  }

  if (showMethod === 'display') {
    el.style.display = 'block'
  } else if (showMethod === 'display-inline') {
    el.style.display = 'inline'
  } else if (showMethod === 'display-inline-block') {
    el.style.display = 'inline-block'
  } else if (showMethod === 'display-flex') {
    el.style.display = 'flex'
  } else if (showMethod === 'display-grid') {
    el.style.display = 'grid'
  } else if (showMethod === 'visibility') {
    el.style.visibility = 'visible'
  } else if (showMethod === 'opacity') {
    el.style.opacity = '1'
  } else if (showMethod === 'remove-hidden') {
    el.removeAttribute('hidden')
  } else {
    return { success: false, error: 'Unknown showMethod: ' + showMethod }
  }

  return { success: true }
}

export const elementShow: NodeHandlerGenerator = {
  nodeType: 'element-show',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_show)
  },
}
