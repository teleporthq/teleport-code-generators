import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_get_media_devices() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return { devices: [], error: 'MediaDevices API is not supported' }
    }

    const deviceList = await navigator.mediaDevices.enumerateDevices()
    const devices = deviceList.map((d) => ({
      deviceId: d.deviceId,
      kind: d.kind,
      label: d.label,
      groupId: d.groupId,
    }))

    return { devices }
  } catch (err: unknown) {
    return { devices: [], error: (err as Error).message }
  }
}
export const browserGetMediaDevices: NodeHandlerGenerator = {
  nodeType: 'browser-get-media-devices',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_get_media_devices)
  },
}
