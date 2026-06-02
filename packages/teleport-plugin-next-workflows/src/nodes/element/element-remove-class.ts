import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_remove_class(config: any, context: Record<string, unknown>) {
  const nodeId = config.nodeId
  const className = config.className

  const el =
    document.getElementById(nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  if (!el) {
    return { success: false }
  }

  // Normalise to individual tokens: `classList.remove` throws a DOMException on
  // an empty string or a token containing whitespace (a multi-class value like
  // 'btn active' is a common GUI/AI input). Split on whitespace, drop empties,
  // and guard so the node can never throw and break the workflow.
  const tokens = (Array.isArray(className) ? className : [className])
    .reduce(function (acc: string[], c: unknown) {
      return acc.concat(String(c == null ? '' : c).split(/\s+/))
    }, [])
    .filter(Boolean)
  try {
    for (let i = 0; i < tokens.length; i++) {
      el.classList.remove(tokens[i])
    }
  } catch (e) {
    return { success: false }
  }

  return { success: true }
}
export const elementRemoveClass: NodeHandlerGenerator = {
  nodeType: 'element-remove-class',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_remove_class)
  },
}
