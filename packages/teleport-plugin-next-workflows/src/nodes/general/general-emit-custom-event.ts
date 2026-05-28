import { NodeHandlerGenerator, handlerToString } from '../types'

async function general_emit_custom_event(config: any, context: Record<string, unknown>) {
  const eventName = config.eventName
  const eventData = config.eventData || {}
  const scope = config.scope || 'global'

  try {
    const event = new CustomEvent(eventName, {
      detail: eventData,
      bubbles: scope === 'global',
      cancelable: true,
    })
    window.dispatchEvent(event)
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const generalEmitCustomEvent: NodeHandlerGenerator = {
  nodeType: 'general-emit-custom-event',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(general_emit_custom_event)
  },
}
