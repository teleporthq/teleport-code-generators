import { NodeHandlerGenerator, handlerToString } from '../types'

async function state_update_global_state(config: any, context: Record<string, unknown>) {
  const property = config.property

  if (config.refreshFromDataSource) {
    return { success: true, property, refreshFromDataSource: true }
  }

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
export const stateUpdateGlobalState: NodeHandlerGenerator = {
  nodeType: 'state-update-global-state',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(state_update_global_state)
  },
}
