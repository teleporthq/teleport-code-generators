import { NodeHandlerGenerator, handlerToString } from '../types'

async function event_workflow_error(config: unknown, context: Record<string, unknown>) {
  return {}
}

export const eventWorkflowError: NodeHandlerGenerator = {
  nodeType: 'event-workflow-error',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(event_workflow_error)
  },
}
