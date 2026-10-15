import { transformSync } from '@babel/core'
import { PageArrival } from '../../src'

/**
 * Runs the emitted `utils/page-arrival.js` against a one-component hook
 * runtime and a scriptable `next/router`, and reads the key the page is
 * rendered with — a new key is a remount, which is what re-runs everything the
 * page computes on arrival.
 */

type Handler = (...args: unknown[]) => void

const createFakeRouter = (pathname: string) => {
  const handlers: Record<string, Handler[]> = {}
  return {
    pathname,
    handlers,
    events: {
      on: (event: string, handler: Handler) => {
        handlers[event] = [...(handlers[event] || []), handler]
      },
      off: (event: string, handler: Handler) => {
        handlers[event] = (handlers[event] || []).filter((candidate) => candidate !== handler)
      },
    },
    emit(event: string, ...args: unknown[]) {
      ;(handlers[event] || []).slice().forEach((handler) => handler(...args))
    },
  }
}

type FakeRouter = ReturnType<typeof createFakeRouter>

const loadWrapper = (router: FakeRouter) => {
  const source = PageArrival.generatePageArrivalRuntime()
    .replace(/^import .*$/gm, '')
    .replace('export default function', 'function')
  const code = transformSync(source, {
    presets: ['@babel/preset-react'],
    babelrc: false,
    configFile: false,
  })?.code

  // One mounted component: state slots survive re-renders, an effect with
  // `[]` runs on the first render only and its cleanup on unmount.
  const states: unknown[] = []
  const cleanups: Array<() => void> = []
  let stateCursor = 0
  let effectCursor = 0
  let onUpdate: () => void = () => undefined

  const React = {
    createElement: (type: unknown, config: { key?: unknown } & Record<string, unknown>) => ({
      type,
      key: config.key,
      props: config,
    }),
  }
  const useState = (initial: unknown) => {
    const slot = stateCursor++
    if (!(slot in states)) {
      states[slot] = initial
    }
    const setState = (next: unknown) => {
      states[slot] =
        typeof next === 'function' ? (next as (v: unknown) => unknown)(states[slot]) : next
      onUpdate()
    }
    return [states[slot], setState]
  }
  const useEffect = (effect: () => (() => void) | void) => {
    const slot = effectCursor++
    if (!(slot in cleanups)) {
      cleanups[slot] = (effect() as () => void) || (() => undefined)
    }
  }

  // tslint:disable-next-line:function-constructor
  const factory = new Function(
    'React',
    'useState',
    'useEffect',
    'Router',
    `${code}\nreturn remountOnPageArrival`
  )
  const remountOnPageArrival = factory(React, useState, useEffect, router)

  function Customers(): null {
    return null
  }
  const Wrapped = remountOnPageArrival(Customers)

  let updates = 0
  const render = () => {
    stateCursor = 0
    effectCursor = 0
    return Wrapped({ title: 'Customers' }) as { type: unknown; key: unknown; props: object }
  }
  onUpdate = () => {
    updates++
  }

  return {
    Wrapped,
    Customers,
    render,
    unmount: () => cleanups.forEach((cleanup) => cleanup()),
    updates: () => updates,
  }
}

const navigate = (router: FakeRouter, to: string, options: { shallow: boolean }) => {
  router.emit('routeChangeStart', to, options)
  router.pathname = to.split('?')[0]
  router.emit('routeChangeComplete', to, options)
}

describe('page-arrival runtime', () => {
  it('renders the page with its props and a stable first key', () => {
    const router = createFakeRouter('/customers')
    const page = loadWrapper(router)

    const element = page.render()

    expect(element.type).toBe(page.Customers)
    expect(element.key).toBe(0)
    expect(element.props).toMatchObject({ title: 'Customers' })
    expect(page.render().key).toBe(0)
  })

  it('remounts the page when a navigation lands on the page already on screen', () => {
    const router = createFakeRouter('/customers')
    const page = loadWrapper(router)
    page.render()

    navigate(router, '/customers', { shallow: false })
    expect(page.render().key).toBe(1)

    navigate(router, '/customers?status=open', { shallow: false })
    expect(page.render().key).toBe(2)
  })

  it('keeps the page as it is for shallow navigations', () => {
    const router = createFakeRouter('/customers')
    const page = loadWrapper(router)
    page.render()

    navigate(router, '/customers?page=2', { shallow: true })

    expect(page.updates()).toBe(0)
    expect(page.render().key).toBe(0)
  })

  it('does not count the navigation that brought the page in', () => {
    const router = createFakeRouter('/customers')
    const page = loadWrapper(router)
    page.render()

    // The page mounted while this navigation was in flight, so it only sees
    // the completion.
    router.emit('routeChangeComplete', '/customers', { shallow: false })

    expect(page.updates()).toBe(0)
  })

  it('ignores a navigation that ends on another route', () => {
    const router = createFakeRouter('/customers')
    const page = loadWrapper(router)
    page.render()

    navigate(router, '/', { shallow: false })

    expect(page.updates()).toBe(0)
  })

  it('forgets a navigation that failed or was cancelled', () => {
    const router = createFakeRouter('/customers')
    const page = loadWrapper(router)
    page.render()

    router.emit('routeChangeStart', '/customers?id=1', { shallow: false })
    router.emit('routeChangeError', new Error('cancelled'), '/customers?id=1', { shallow: false })
    router.emit('routeChangeComplete', '/customers?id=1', { shallow: true })

    expect(page.updates()).toBe(0)
  })

  it('stops listening once the page unmounts', () => {
    const router = createFakeRouter('/customers')
    const page = loadWrapper(router)
    page.render()

    expect(router.handlers.routeChangeStart).toHaveLength(1)
    expect(router.handlers.routeChangeComplete).toHaveLength(1)
    expect(router.handlers.routeChangeError).toHaveLength(1)

    page.unmount()

    expect(router.handlers.routeChangeStart).toHaveLength(0)
    expect(router.handlers.routeChangeComplete).toHaveLength(0)
    expect(router.handlers.routeChangeError).toHaveLength(0)
  })

  it('names the wrapper after the page for React DevTools', () => {
    const page = loadWrapper(createFakeRouter('/customers'))

    expect(page.Wrapped.displayName).toBe('PageArrival(Customers)')
  })
})
