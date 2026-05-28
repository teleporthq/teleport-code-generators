import { NodeHandlerGenerator, handlerToString } from '../types'

async function general_loop(config: any, context: Record<string, unknown>) {
  return { completed: true, iterations: 0 }
}
export const generalLoop: NodeHandlerGenerator = {
  nodeType: 'general-loop',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(general_loop)
  },
}
