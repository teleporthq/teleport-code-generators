import { NodeHandlerGenerator, handlerToString } from '../types'

// A write in the visitor's own tab fires no `storage` event. This one lets page
// scripts react at once: Google consent mode is granted by the cookie banner's
// Accept, which is this step (teleport-project-generator-next google-consent-mode).
async function storage_local_set(config: any, context: Record<string, unknown>) {
  const key = config.key
  const value = config.value

  try {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    localStorage.setItem(key, serialized)
    window.dispatchEvent(
      new CustomEvent('teleport:local-storage', { detail: { key, value: serialized } })
    )
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
