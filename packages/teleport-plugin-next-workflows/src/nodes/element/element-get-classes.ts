import { NodeHandlerGenerator, handlerToString } from '../types'

async function element_get_classes(config: any, context: Record<string, unknown>) {
  const el =
    document.getElementById(config.nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)

  if (!el) {
    return { classes: [], classString: '', elementId: config.elementHtmlId || config.nodeId }
  }

  return {
    classes: Array.from(el.classList),
    classString: el.className,
    elementId: config.elementHtmlId || config.nodeId,
  }
}

export const elementGetClasses: NodeHandlerGenerator = {
  nodeType: 'element-get-classes',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_get_classes)
  },
}
