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

  // `classList.toggle` accepts only a single token and throws a DOMException on
  // an empty string or a token containing whitespace. Split a multi-class value
  // ('is-open active') into tokens, drop empties, and guard so the node can
  // never throw and break the workflow.
  const tokens = (Array.isArray(className) ? className : [className])
    .reduce(function (acc: string[], c: unknown) {
      return acc.concat(String(c == null ? '' : c).split(/\s+/))
    }, [])
    .filter(Boolean)
  try {
    for (let i = 0; i < tokens.length; i++) {
      if (force !== undefined) {
        el.classList.toggle(tokens[i], force)
      } else {
        el.classList.toggle(tokens[i])
      }
    }
  } catch (e) {
    return { success: false }
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
