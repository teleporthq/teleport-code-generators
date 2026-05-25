import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_scroll_to(config: any, context: Record<string, unknown>) {
  const nodeId = config.nodeId
  const behavior = config.behavior || 'smooth'
  const block = config.block || 'start'
  const inline = config.inline || 'nearest'
  const offset = config.offset || 0

  const el =
    document.getElementById(nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { success: false }
  }

  el.scrollIntoView({
    behavior,
    block,
    inline,
  })

  if (offset) {
    window.scrollBy({ top: offset, behavior })
  }

  return { success: true }
}
export const elementScrollTo: NodeHandlerGenerator = {
  nodeType: 'element-scroll-to',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_scroll_to)
  },
}
