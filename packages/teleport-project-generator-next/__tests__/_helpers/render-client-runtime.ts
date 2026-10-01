import { SERVICE_WORKER_COMPONENT_NAME } from '../../src/pwa/constants'
import { moduleBody } from './load-client-runtime'

/**
 * Renders the generated `components/teleport-service-worker.js` component with a
 * minimal hooks runtime inside a fake device — its effects run, its timers run
 * when told to, and a canvas records what is drawn on it — and returns the
 * element tree it renders.
 */

export interface FakeDevice {
  userAgent: string
  platform: string
  maxTouchPoints: number
  standalone: boolean
  /** CSS px, as `window.screen` reports them. */
  screen: { width: number; height: number }
  devicePixelRatio: number
  /** Kept between page loads, like the browser's. */
  localStorage: Map<string, string>
  /** The launch-screen icon fails to load. */
  iconMissing: boolean
}

export const iPhone = (overrides: Partial<FakeDevice> = {}): FakeDevice => ({
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
  maxTouchPoints: 5,
  standalone: false,
  screen: { width: 390, height: 844 },
  devicePixelRatio: 3,
  localStorage: new Map(),
  iconMissing: false,
  ...overrides,
})

export interface CanvasOperation {
  name: string
  args: unknown[]
}

export interface FakeCanvas {
  width: number
  height: number
  operations: CanvasOperation[]
}

export interface RenderedElement {
  type: unknown
  props: Record<string, unknown>
  children: unknown[]
}

const isElement = (value: unknown): value is RenderedElement =>
  !!value && typeof value === 'object' && 'props' in value && 'children' in value

/** Every element of `type` in the tree, depth first. */
export const findElements = (tree: unknown, type: string): RenderedElement[] => {
  if (Array.isArray(tree)) {
    return tree.flatMap((child) => findElements(child, type))
  }
  if (!isElement(tree)) {
    return []
  }
  return [...(tree.type === type ? [tree] : []), ...findElements(tree.children, type)]
}

const createCanvas = (canvases: FakeCanvas[]) => {
  const canvas: FakeCanvas & Record<string, unknown> = { width: 0, height: 0, operations: [] }
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      canvas.operations.push({ name, args })
    }
  const context = new Proxy(
    {},
    {
      get: (_target, name: string) => record(name),
      set: (_target, name: string, value) => {
        canvas.operations.push({ name: `set ${name}`, args: [value] })
        return true
      },
    }
  )
  const dataUrl = () => `data:image/png;base64,${canvas.width}x${canvas.height}`
  canvas.getContext = () => context
  canvas.toDataURL = dataUrl
  canvas.toBlob = (callback: (blob: { dataUrl: string }) => void) =>
    callback({ dataUrl: dataUrl() })
  canvases.push(canvas)
  return canvas
}

export const renderClientRuntime = (source: string, device: FakeDevice) => {
  const canvases: FakeCanvas[] = []
  const timers: Array<{ callback: () => void; delay: number; cleared: boolean }> = []

  // Hooks: state keeps its slot between renders; effects run once, after the first.
  const slots: unknown[] = []
  let cursor = 0
  let pendingEffects: Array<() => unknown> = []
  let mounted = false
  const useState = (initial: unknown) => {
    const index = cursor++
    if (!(index in slots)) {
      slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
    }
    const setState = (next: unknown) => {
      slots[index] =
        typeof next === 'function' ? (next as (value: unknown) => unknown)(slots[index]) : next
    }
    return [slots[index], setState]
  }
  const useEffect = (effect: () => unknown) => {
    if (!mounted) {
      pendingEffects.push(effect)
    }
  }
  const useCallback = (callback: unknown) => callback
  const createElement = (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => ({
    type,
    props: props || {},
    children: children.flat(),
  })

  const storage = (values: Map<string, string>) => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
  })

  function FakeImage(this: Record<string, unknown>) {
    let imageSrc = ''
    Object.defineProperty(this, 'src', {
      get: () => imageSrc,
      set: (value: string) => {
        imageSrc = value
        queueMicrotask(() => {
          const handler = device.iconMissing ? this.onerror : this.onload
          if (typeof handler === 'function') {
            handler()
          }
        })
      },
    })
  }

  function FakeFileReader(this: Record<string, unknown>) {
    this.readAsDataURL = (blob: { dataUrl: string }) => {
      this.result = blob.dataUrl
      queueMicrotask(() => (this.onload as () => void)())
    }
  }

  const noop = (): undefined => undefined
  const windowFake: Record<string, unknown> = {
    isSecureContext: true,
    screen: device.screen,
    devicePixelRatio: device.devicePixelRatio,
    localStorage: storage(device.localStorage),
    sessionStorage: storage(new Map()),
    matchMedia: () => ({ matches: device.standalone }),
    setTimeout: (callback: () => void, delay: number) => {
      timers.push({ callback, delay, cleared: false })
      return timers.length
    },
    clearTimeout: (id: number) => {
      if (timers[id - 1]) {
        timers[id - 1].cleared = true
      }
    },
    addEventListener: noop,
    removeEventListener: noop,
    Image: FakeImage,
    FileReader: FakeFileReader,
  }
  windowFake.self = windowFake
  windowFake.top = windowFake
  const navigatorFake = {
    userAgent: device.userAgent,
    platform: device.platform,
    maxTouchPoints: device.maxTouchPoints,
    standalone: device.standalone,
  }
  const documentFake = { createElement: () => createCanvas(canvases) }

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const evaluate = new Function(
    'window',
    'navigator',
    'document',
    'Notification',
    'fetch',
    'process',
    'React',
    'useCallback',
    'useEffect',
    'useState',
    'Head',
    'useRouter',
    `${moduleBody(source)}\nreturn ${SERVICE_WORKER_COMPONENT_NAME}`
  )
  const Component = evaluate(
    windowFake,
    navigatorFake,
    documentFake,
    { permission: 'default' },
    noop,
    { env: { NODE_ENV: 'production' } },
    { createElement, Fragment: 'fragment' },
    useCallback,
    useEffect,
    useState,
    'Head',
    () => ({ asPath: '/', locale: 'en' })
  ) as () => unknown

  const render = (): unknown => {
    cursor = 0
    const tree = Component()
    if (!mounted) {
      mounted = true
      const effects = pendingEffects
      pendingEffects = []
      effects.forEach((effect) => effect())
    }
    return tree
  }

  /** Runs the timers due so far, then lets the work they started finish. */
  const runTimers = async (): Promise<void> => {
    timers
      .filter((timer) => !timer.cleared)
      .forEach((timer) => {
        timer.cleared = true
        timer.callback()
      })
    for (let tick = 0; tick < 10; tick++) {
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  return { render, runTimers, canvases, timers }
}
