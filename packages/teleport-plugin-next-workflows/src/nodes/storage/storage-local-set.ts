import { NodeHandlerGenerator, handlerToString } from '../types'

async function storage_local_set(config: any, context: Record<string, unknown>) {
  const key = config.key
  const value = config.value

  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    localStorage.setItem(key, serialized)
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const storageLocalSet: NodeHandlerGenerator = {
  nodeType: 'storage-local-set',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(storage_local_set)
  },
}
