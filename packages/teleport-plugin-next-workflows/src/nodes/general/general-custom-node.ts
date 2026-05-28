import { NodeHandlerGenerator, handlerToString } from '../types'

async function general_custom_node(config: any, context: Record<string, unknown>) {
  const customNodeId = config.customNodeId
  const parameters = config.parameters || {}

  return { __customNode: true, customNodeId, parameters }
}
export const generalCustomNode: NodeHandlerGenerator = {
  nodeType: 'general-custom-node',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(general_custom_node)
  },
}
