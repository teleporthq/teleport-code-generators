import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_get_attribute(config: any, context: Record<string, unknown>) {
  // Prefer the actual clicked element (triggerElement) so duplicate ids emitted by
  // list-rendered templates don't collapse to the first DOM match.
  const triggerEl: any = (context as any) && (context as any).triggerElement
  let el: any = null

  if (triggerEl && typeof triggerEl.closest === 'function' && config.attribute) {
    const match = triggerEl.closest('[' + config.attribute + ']')
    if (match) {
      el = match
    }
  }

  if (!el && triggerEl && config.elementHtmlId && triggerEl.id === config.elementHtmlId) {
    el = triggerEl
  }

  if (!el) {
    el =
      document.getElementById(config.nodeId) ||
      (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  }

  if (!el) {
    return {
      value: null,
      attribute: config.attribute,
      elementId: config.elementHtmlId || config.nodeId,
    }
  }

  let value = el.getAttribute(config.attribute)
  if (value === null && config.attribute && typeof el.closest === 'function') {
    const ancestor = el.closest('[' + config.attribute + ']')
    if (ancestor) {
      value = ancestor.getAttribute(config.attribute)
    }
  }

  return {
    value,
    attribute: config.attribute,
    elementId: config.elementHtmlId || config.nodeId,
  }
}

export const elementGetAttribute: NodeHandlerGenerator = {
  nodeType: 'element-get-attribute',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_get_attribute)
  },
  generateServerHandler(): string {
    return `async function element_get_attribute(config, context) {
  var nid = config.__nodeId
  if (nid !== undefined && context[nid] !== undefined) return context[nid]
  return {
    value: null,
    attribute: config.attribute,
    elementId: config.elementHtmlId || config.nodeId,
  }
}`
  },
}
