import { NodeHandlerGenerator, handlerToString } from '../types'

async function audio_play(config: any) {
  let instances = (window as any).__teleportAudioInstances
  if (!instances) {
    instances = new Map()
    ;(window as any).__teleportAudioInstances = instances
  }

  const url = config.audioUrl
  const audioId = config.audioId
  let audio = instances.get(audioId)

  if (audio && !config.allowOverlap) {
    audio.pause()
    audio.currentTime = 0
  }

  if (!audio || config.allowOverlap) {
    audio = new Audio(url)
    if (!config.allowOverlap) {
      instances.set(audioId, audio)
    }
  }

  audio.loop = config.loop || false
  audio.volume = config.volume != null ? config.volume : 1
  audio.playbackRate = config.playbackRate || 1

  try {
    await audio.play()
    return { audioId, playing: true, duration: audio.duration || 0 }
  } catch (err: unknown) {
    return { audioId, playing: false, duration: 0 }
  }
}

export const audioPlay: NodeHandlerGenerator = {
  nodeType: 'audio-play',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(audio_play)
  },
}
