import { NodeHandlerGenerator, handlerToString } from '../types'

async function storage_session_remove(config: any, context: Record<string, unknown>) {
  const key = config.key

  try {
    sessionStorage.removeItem(key)
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const storageSessionRemove: NodeHandlerGenerator = {
  nodeType: 'storage-session-remove',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(storage_session_remove)
  },
}
