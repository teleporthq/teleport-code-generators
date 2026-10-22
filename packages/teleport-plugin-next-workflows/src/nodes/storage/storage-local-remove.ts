import { NodeHandlerGenerator, handlerToString } from '../types'

// Same-tab notice of the removal, as storage-local-set gives for a write.
async function storage_local_remove(config: any, context: Record<string, unknown>) {
  const key = config.key

  try {
    localStorage.removeItem(key)
    window.dispatchEvent(
      new CustomEvent('teleport:local-storage', { detail: { key, value: null } })
    )
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const storageLocalRemove: NodeHandlerGenerator = {
  nodeType: 'storage-local-remove',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(storage_local_remove)
  },
}
