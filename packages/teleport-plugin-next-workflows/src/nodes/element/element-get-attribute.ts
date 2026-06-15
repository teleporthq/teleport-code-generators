import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_get_attribute(config: any, context: Record<string, unknown>) {
  // The workflow editor's canonical config key is `attribute`, but AI-generated
  // (and some legacy) nodes emit `attributeName`. Accept both so the node reads
  // the attribute the author intended instead of `getAttribute(undefined)` → null.
  const attr: string = config.attribute || config.attributeName

  // Prefer the actual clicked element (triggerElement) so duplicate ids emitted by
  // list-rendered templates don't collapse to the first DOM match.
  const triggerEl: any = (context as any) && (context as any).triggerElement
  let el: any = null

  if (triggerEl && typeof triggerEl.closest === 'function' && attr) {
    const match = triggerEl.closest('[' + attr + ']')
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
      attribute: attr,
      elementId: config.elementHtmlId || config.nodeId,
    }
  }

  // For form controls the live, user-entered value lives on the DOM *property*
  // (el.value / el.checked), not the HTML *attribute* — React keeps the
  // attribute at its initial server-rendered value. Reading the property makes
  // "get the value/checked of this input/select/textarea" return what the user
  // actually typed/selected. typeof guards scope this to real form controls;
  // plain data-attributes (e.g. data-item-id) fall through to getAttribute.
  if (attr === 'value' && typeof el.value !== 'undefined') {
    return {
      value: el.value,
      attribute: attr,
      elementId: config.elementHtmlId || config.nodeId,
    }
  }
  if (attr === 'checked' && typeof el.checked !== 'undefined') {
    return {
      value: el.checked,
      attribute: attr,
      elementId: config.elementHtmlId || config.nodeId,
    }
  }

  let value = el.getAttribute(attr)
  if (value === null && attr && typeof el.closest === 'function') {
    const ancestor = el.closest('[' + attr + ']')
    if (ancestor) {
      value = ancestor.getAttribute(attr)
    }
  }

  return {
    value,
    attribute: attr,
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
    attribute: config.attribute || config.attributeName,
    elementId: config.elementHtmlId || config.nodeId,
  }
}`
  },
}
