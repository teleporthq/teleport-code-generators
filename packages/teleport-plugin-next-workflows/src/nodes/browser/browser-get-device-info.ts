import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_get_device_info() {
  try {
    return {
      userAgent: navigator.userAgent || '',
      platform: navigator.platform || '',
      language: navigator.language || '',
      cookiesEnabled: navigator.cookieEnabled || false,
      screenWidth: screen.width || 0,
      screenHeight: screen.height || 0,
      pixelRatio: window.devicePixelRatio || 1,
      touchSupport: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    }
  } catch (err: unknown) {
    return { error: (err as Error).message }
  }
}
export const browserGetDeviceInfo: NodeHandlerGenerator = {
  nodeType: 'browser-get-device-info',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_get_device_info)
  },
}
