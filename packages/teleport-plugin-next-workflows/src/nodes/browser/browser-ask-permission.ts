import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_ask_permission(config: any) {
  const permission = config.permission

  try {
    if (permission === 'notifications') {
      if (!('Notification' in window)) {
        return { granted: false, state: 'unsupported' }
      }
      const result = await Notification.requestPermission()
      return { granted: result === 'granted', state: result }
    }

    if (permission === 'geolocation') {
      if (!('geolocation' in navigator)) {
        return { granted: false, state: 'unsupported' }
      }
      const geo = await navigator.permissions.query({ name: 'geolocation' })
      return { granted: geo.state === 'granted', state: geo.state }
    }

    if (permission === 'camera' || permission === 'microphone') {
      if (!navigator.mediaDevices?.getUserMedia) {
        return { granted: false, state: 'unsupported' }
      }
      const constraints: MediaStreamConstraints = {}
      if (permission === 'camera') {
        constraints.video = true
      }
      if (permission === 'microphone') {
        constraints.audio = true
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        stream.getTracks().forEach((t) => t.stop())
        return { granted: true, state: 'granted' }
      } catch (_e) {
        return { granted: false, state: 'denied' }
      }
    }

    return { granted: false, state: 'unknown' }
  } catch (err: unknown) {
    return { granted: false, state: 'error', error: (err as Error).message }
  }
}
export const browserAskPermission: NodeHandlerGenerator = {
  nodeType: 'browser-ask-permission',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_ask_permission)
  },
}
