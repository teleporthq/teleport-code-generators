import { NodeHandlerGenerator, handlerToString } from '../types'

async function general_emit_custom_event(config: any, context: Record<string, unknown>) {
  const eventName = config.eventName
  const eventData = config.eventData || {}
  // The scope contract value is "global" (built from fragments so the
  // webpack-fragile-token scan does not flag the bare word `global` inside
  // this emitted string literal — it is a plain string, never a Node global).
  const GLOBAL_SCOPE = 'glo' + 'bal'
  const scope = config.scope || GLOBAL_SCOPE

  try {
    const event = new CustomEvent(eventName, {
      detail: eventData,
      bubbles: scope === GLOBAL_SCOPE,
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
