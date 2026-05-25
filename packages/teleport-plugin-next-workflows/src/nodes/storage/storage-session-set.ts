import { NodeHandlerGenerator, handlerToString } from '../types'

async function storage_session_set(config: any, context: Record<string, unknown>) {
  const key = config.key
  const value = config.value

  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    sessionStorage.setItem(key, serialized)
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const storageSessionSet: NodeHandlerGenerator = {
  nodeType: 'storage-session-set',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(storage_session_set)
  },
}
