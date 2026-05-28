import { NodeHandlerGenerator } from '../types'
import { buildStateGetHandlerSource } from './_state-get'

// On the client, workflow-component-plugin.ts overrides this handler with
// one that reads from the live React `stateValuesRef` so trigger-time
// snapshots can't go stale. The implementation here is the SERVER-segment
// fallback (and the contract the override must match): both must return
// `{ value, key }` so any workflow binding to `<get-state>.key` resolves
// to the configured property name regardless of where the node runs.
export const stateGetLocalState: NodeHandlerGenerator = {
  nodeType: 'state-get-local-state',
  executionEnv: 'client',
  generateHandler(): string {
    return buildStateGetHandlerSource('state_get_local_state')
  },
}
