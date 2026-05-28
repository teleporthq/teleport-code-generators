export type HandlerFn = (config: unknown, context: Record<string, unknown>) => Promise<unknown>

export function handlerToString(fn: HandlerFn): string {
  return fn.toString()
}

export interface NodeHandlerGenerator {
  nodeType: string
  executionEnv: 'client' | 'server' | 'universal'
  isTerminal?: boolean
  dependencies?: Record<string, string>
  generateHandler(): string
  generateServerHandler?(): string
}

export interface IntegrationHandlerGenerator extends NodeHandlerGenerator {
  secretFields: string[]
}
