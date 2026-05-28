import { NodeHandlerGenerator } from '../types'
import { buildStorageGetHandlerSource } from './_storage-get'

export const storageLocalGet: NodeHandlerGenerator = {
  nodeType: 'storage-local-get',
  executionEnv: 'client',
  generateHandler(): string {
    return buildStorageGetHandlerSource('storage_local_get', 'localStorage')
  },
}
