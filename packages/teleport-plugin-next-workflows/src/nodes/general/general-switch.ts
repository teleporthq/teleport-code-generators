import { NodeHandlerGenerator, handlerToString } from '../types'

async function general_switch(config: any, context: Record<string, unknown>) {
  return { matchedCase: 'default' }
}
export const generalSwitch: NodeHandlerGenerator = {
  nodeType: 'general-switch',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(general_switch)
  },
}
