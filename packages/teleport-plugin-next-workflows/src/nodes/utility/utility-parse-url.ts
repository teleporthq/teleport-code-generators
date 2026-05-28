import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_parse_url(config: any, context: Record<string, unknown>) {
  const url = config.url || ''

  if (!url) {
    return {
      protocol: null,
      host: null,
      hostname: null,
      port: null,
      pathname: null,
      search: null,
      hash: null,
      origin: null,
      params: {},
      error: 'No URL provided',
    }
  }

  try {
    const parsed = new URL(url)
    const params: Record<string, any> = {}

    parsed.searchParams.forEach(function (value: string, key: string) {
      if (params[key] !== undefined) {
        if (!Array.isArray(params[key])) {
          params[key] = [params[key]]
        }
        params[key].push(value)
      } else {
        params[key] = value
      }
    })

    const pathSegments = parsed.pathname.split('/').filter(function (s: string) {
      return s.length > 0
    })

    const isSecure = parsed.protocol === 'https:'
    let subdomain = ''
    let domain = parsed.hostname
    const hostParts = parsed.hostname.split('.')
    if (hostParts.length > 2) {
      subdomain = hostParts.slice(0, hostParts.length - 2).join('.')
      domain = hostParts.slice(hostParts.length - 2).join('.')
    }

    return {
      protocol: parsed.protocol,
      host: parsed.host,
      hostname: parsed.hostname,
      port:
        parsed.port ||
        (parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : ''),
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
      origin: parsed.origin,
      params,
      pathSegments,
      subdomain,
      domain,
      isSecure,
      username: parsed.username || null,
      password: parsed.password || null,
    }
  } catch (err: unknown) {
    return {
      protocol: null,
      host: null,
      hostname: null,
      port: null,
      pathname: null,
      search: null,
      hash: null,
      origin: null,
      params: {},
      error: (err as Error).message,
    }
  }
}
export const utilityParseUrl: NodeHandlerGenerator = {
  nodeType: 'utility-parse-url',
  executionEnv: 'server',
  generateHandler(): string {
    return handlerToString(utility_parse_url)
  },
}
