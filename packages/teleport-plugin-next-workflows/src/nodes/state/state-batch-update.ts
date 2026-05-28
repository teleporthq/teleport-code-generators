import { NodeHandlerGenerator, handlerToString } from '../types'

async function state_batch_update(config: any) {
  const updates = config.updates || []
  const updatedKeys: string[] = []
  for (let i = 0; i < updates.length; i++) {
    updatedKeys.push(updates[i].key)
  }
  return { updatedKeys, updateCount: updatedKeys.length }
}

export const stateBatchUpdate: NodeHandlerGenerator = {
  nodeType: 'state-batch-update',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(state_batch_update)
  },
}
