import { NodeHandlerGenerator } from '../types'
import { buildStateGetHandlerSource } from './_state-get'

export const stateGetGlobalState: NodeHandlerGenerator = {
  nodeType: 'state-get-global-state',
  executionEnv: 'client',
  generateHandler(): string {
    return buildStateGetHandlerSource('state_get_global_state')
  },
}
