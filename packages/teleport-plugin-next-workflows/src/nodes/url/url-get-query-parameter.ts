import { NodeHandlerGenerator, handlerToString } from '../types'

async function url_get_query_parameter(config: any, context: Record<string, unknown>) {
  const parameterName = config.parameterName
  const defaultValue = config.defaultValue || ''

  const params = new URLSearchParams(window.location.search)
  const value = params.get(parameterName)

  return { value: value !== null ? value : defaultValue }
}
export const urlGetQueryParameter: NodeHandlerGenerator = {
  nodeType: 'url-get-query-parameter',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(url_get_query_parameter)
  },
}
