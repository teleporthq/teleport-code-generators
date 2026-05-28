import { NodeHandlerGenerator } from '../types'
import { buildStorageGetHandlerSource } from './_storage-get'

export const storageSessionGet: NodeHandlerGenerator = {
  nodeType: 'storage-session-get',
  executionEnv: 'client',
  generateHandler(): string {
    return buildStorageGetHandlerSource('storage_session_get', 'sessionStorage')
  },
}
