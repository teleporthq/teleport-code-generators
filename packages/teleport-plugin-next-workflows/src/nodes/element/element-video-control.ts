import { NodeHandlerGenerator, handlerToString } from '../types'

/**
 * "Control a Video": play / pause / play-or-pause / restart / mute / unmute
 * the bound Video element (or the first <video> inside the bound element).
 * A play the browser blocks for sound (autoplay policy: no user gesture yet,
 * e.g. a chapter-reached trigger) is retried muted, so the video still
 * starts, and the result says so. Client-only: it needs the DOM.
 */
async function element_video_control(config: any, context: Record<string, unknown>) {
  const action = typeof config.action === 'string' ? config.action : 'play'
  const host =
    document.getElementById(config.nodeId) ||
    (config.elementHtmlId ? document.getElementById(config.elementHtmlId) : null)
  const video = host
    ? host.tagName === 'VIDEO'
      ? (host as HTMLVideoElement)
      : (host.querySelector('video') as HTMLVideoElement | null)
    : null
  if (!video) {
    return { success: false, action, reason: 'video-not-found' }
  }

  const state = (extra?: Record<string, unknown>) => {
    const result: Record<string, unknown> = {
      success: true,
      action,
      playing: !video.paused && !video.ended,
      currentTime: video.currentTime,
      muted: video.muted,
    }
    if (extra) {
      Object.keys(extra).forEach((key) => {
        result[key] = extra[key]
      })
    }
    return result
  }

  const play = async () => {
    try {
      await video.play()
      return null
    } catch (error) {
      if (video.muted) {
        return 'blocked'
      }
      video.muted = true
      try {
        await video.play()
        return 'muted'
      } catch (retryError) {
        return 'blocked'
      }
    }
  }

  const playAndReport = async () => {
    const outcome = await play()
    if (outcome === 'blocked') {
      return state({ success: false, reason: 'autoplay-blocked' })
    }
    return outcome === 'muted' ? state({ mutedFallback: true }) : state()
  }

  if (action === 'pause') {
    video.pause()
    return state()
  }
  if (action === 'mute') {
    video.muted = true
    return state()
  }
  if (action === 'unmute') {
    video.muted = false
    return state()
  }
  if (action === 'restart') {
    video.currentTime = 0
    return playAndReport()
  }
  if (action === 'toggle' && !video.paused && !video.ended) {
    video.pause()
    return state()
  }
  return playAndReport()
}

export const elementVideoControl: NodeHandlerGenerator = {
  nodeType: 'element-video-control',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(element_video_control)
  },
}
