// "Control a Video" runs in the browser against the bound Video element. The
// generated handler is exercised here on a stubbed DOM: every action, the
// container-holding-a-video case, and the muted retry when the browser
// blocks a play with sound.

import { nodeRegistry } from '../src'
import { resolveHandlerEntryName } from '../src/nodes/types'

type Handler = (config: Record<string, unknown>, context: Record<string, unknown>) => Promise<any>

const loadHandler = (): Handler => {
  const source = nodeRegistry['element-video-control'].generateHandler()
  const entry = resolveHandlerEntryName(source, 'element-video-control')
  // eslint-disable-next-line no-new-func
  return new Function(`${source}\nreturn ${entry};`)() as Handler
}

const fakeVideo = (options: { blockSound?: boolean } = {}) => {
  const video: any = {
    tagName: 'VIDEO',
    paused: true,
    ended: false,
    muted: false,
    currentTime: 12,
    playCalls: 0,
    play() {
      this.playCalls += 1
      if (options.blockSound && !this.muted) {
        return Promise.reject(new Error('NotAllowedError'))
      }
      this.paused = false
      return Promise.resolve()
    },
    pause() {
      this.paused = true
    },
  }
  return video
}

const withDom = (byId: Record<string, any>) => {
  ;(globalThis as any).document = {
    getElementById: (id: string) => byId[id] || null,
  }
}

describe('element-video-control — generated handler', () => {
  afterEach(() => {
    delete (globalThis as any).document
  })

  it('registers as a client-side element node', () => {
    expect(nodeRegistry['element-video-control'].executionEnv).toBe('client')
    expect(nodeRegistry['element-video-control'].generateHandler()).not.toContain('`')
  })

  it('plays by default and reports the state', async () => {
    const video = fakeVideo()
    withDom({ hero: video })
    const result = await loadHandler()({ nodeId: 'hero' }, {})
    expect(result).toMatchObject({ success: true, action: 'play', playing: true, currentTime: 12 })
    expect(video.playCalls).toBe(1)
  })

  it('finds the video inside a bound container and resolves the html id fallback', async () => {
    const video = fakeVideo()
    const container = { tagName: 'DIV', querySelector: () => video }
    withDom({ thq_hero: container })
    const result = await loadHandler()(
      { nodeId: 'TQ_hero', elementHtmlId: 'thq_hero', action: 'pause' },
      {}
    )
    expect(result).toMatchObject({ success: true, action: 'pause', playing: false })
  })

  it('pauses, toggles, restarts, mutes and unmutes', async () => {
    const video = fakeVideo()
    video.paused = false
    withDom({ v: video })
    const handler = loadHandler()
    expect((await handler({ nodeId: 'v', action: 'toggle' }, {})).playing).toBe(false)
    expect((await handler({ nodeId: 'v', action: 'toggle' }, {})).playing).toBe(true)
    const restarted = await handler({ nodeId: 'v', action: 'restart' }, {})
    expect(restarted).toMatchObject({ playing: true, currentTime: 0 })
    expect((await handler({ nodeId: 'v', action: 'mute' }, {})).muted).toBe(true)
    expect((await handler({ nodeId: 'v', action: 'unmute' }, {})).muted).toBe(false)
  })

  it('retries muted when the browser blocks a play with sound, and says so', async () => {
    const video = fakeVideo({ blockSound: true })
    withDom({ v: video })
    const result = await loadHandler()({ nodeId: 'v', action: 'play' }, {})
    expect(result).toMatchObject({ success: true, playing: true, muted: true, mutedFallback: true })
    expect(video.playCalls).toBe(2)
  })

  it('reports a missing video instead of throwing', async () => {
    withDom({})
    const result = await loadHandler()({ nodeId: 'nowhere', action: 'play' }, {})
    expect(result).toEqual({ success: false, action: 'play', reason: 'video-not-found' })
  })
})
