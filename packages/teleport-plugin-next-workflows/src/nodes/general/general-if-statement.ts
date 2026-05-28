import { NodeHandlerGenerator, handlerToString } from '../types'

async function general_if_statement(config: any, context: Record<string, unknown>) {
  return { result: true }
}
export const generalIfStatement: NodeHandlerGenerator = {
  nodeType: 'general-if-statement',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(general_if_statement)
  },
}
