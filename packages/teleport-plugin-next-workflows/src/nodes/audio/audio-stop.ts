import { NodeHandlerGenerator, handlerToString } from '../types'

async function audio_stop(config: any) {
  const instances = (window as any).__teleportAudioInstances
  if (!instances) {
    return { audioId: config.audioId, stopped: false }
  }

  const audioId = config.audioId
  const audio = instances.get(audioId)

  if (!audio || audio.paused) {
    return { audioId, stopped: false }
  }

  if (config.fadeOutMs && config.fadeOutMs > 0) {
    const steps = 20
    const stepMs = config.fadeOutMs / steps
    const volumeStep = audio.volume / steps
    let currentStep = 0
    const fadeAudio = audio

    await new Promise(function (resolve) {
      const fadeInterval = setInterval(function () {
        currentStep++
        fadeAudio.volume = Math.max(0, fadeAudio.volume - volumeStep)
        if (currentStep >= steps) {
          clearInterval(fadeInterval)
          fadeAudio.pause()
          fadeAudio.currentTime = 0
          resolve(undefined)
        }
      }, stepMs)
    })
  } else {
    audio.pause()
    audio.currentTime = 0
  }

  instances.delete(audioId)
  return { audioId, stopped: true }
}

export const audioStop: NodeHandlerGenerator = {
  nodeType: 'audio-stop',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(audio_stop)
  },
}
