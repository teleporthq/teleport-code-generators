import { NodeHandlerGenerator, handlerToString } from '../types'

async function general_parallel(config: any, context: Record<string, unknown>) {
  return { results: [], completedBranches: 0 }
}
export const generalParallel: NodeHandlerGenerator = {
  nodeType: 'general-parallel',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(general_parallel)
  },
}
