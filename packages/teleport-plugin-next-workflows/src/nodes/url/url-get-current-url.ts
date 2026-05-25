import { NodeHandlerGenerator, handlerToString } from '../types'

async function url_get_current_url(config: any, context: Record<string, unknown>) {
  const loc = window.location

  return {
    url: loc.href,
    protocol: loc.protocol,
    host: loc.host,
    hostname: loc.hostname,
    port: loc.port,
    pathname: loc.pathname,
    search: loc.search,
    hash: loc.hash,
    origin: loc.origin,
  }
}
export const urlGetCurrentUrl: NodeHandlerGenerator = {
  nodeType: 'url-get-current-url',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(url_get_current_url)
  },
}
