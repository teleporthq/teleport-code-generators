import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_get_network_status() {
  try {
    const result: Record<string, unknown> = {
      online: navigator.onLine,
      type: null,
      effectiveType: null,
      downlink: null,
      rtt: null,
      saveData: false,
    }

    const conn =
      (navigator as any).connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection
    if (conn) {
      result.type = conn.type || null
      result.effectiveType = conn.effectiveType || null
      result.downlink = conn.downlink != null ? conn.downlink : null
      result.rtt = conn.rtt != null ? conn.rtt : null
      result.saveData = conn.saveData || false
    }

    return result
  } catch (err: unknown) {
    return { online: navigator.onLine, error: (err as Error).message }
  }
}
export const browserGetNetworkStatus: NodeHandlerGenerator = {
  nodeType: 'browser-get-network-status',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_get_network_status)
  },
}
