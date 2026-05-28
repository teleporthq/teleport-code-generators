import { NodeHandlerGenerator, handlerToString } from '../types'

async function state_update_local_state(config: any, context: Record<string, unknown>) {
  const property = config.property
  const value = config.value
  if (config.objectUpdateMode === 'property' && config.objectPropertyPath) {
    const currentObj =
      context && (context as any).__stateValues && (context as any).__stateValues[property] != null
        ? (context as any).__stateValues[property]
        : {}
    const newObj = { ...currentObj, [config.objectPropertyPath]: value }
    return { success: true, property, value: newObj }
  }
  return { success: true, property, value }
}
export const stateUpdateLocalState: NodeHandlerGenerator = {
  nodeType: 'state-update-local-state',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(state_update_local_state)
  },
}
