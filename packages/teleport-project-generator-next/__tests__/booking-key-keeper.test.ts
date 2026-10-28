import generate from '@babel/generator'
import { ChunkDefinition, ProjectPluginStructure, ProjectUIDL } from '@teleporthq/teleport-types'
import { createDocumentFileChunks } from '../src/utils'
import { NextBookingProjectPlugin } from '../src/bookings/project-plugin'
import {
  BOOKING_KEY_KEEPER_SOURCE,
  BOOKING_KEY_STORAGE_PREFIX,
} from '../src/bookings/manage-key-snippet'

// A booking link carries the manage key in its query, and every link already
// emailed keeps that shape. The key must leave the address before any pixel the
// owner added reads `location.href`: the first script of the head keeps it in
// the tab's sessionStorage and takes it out of the address.

/** Runs the keeper against an address; answers what it stored and the address it left. */
const keep = (href: string, options: { storageFails?: boolean } = {}) => {
  const url = new URL(href)
  const stored: Record<string, string> = {}
  let address = url.pathname + url.search + url.hash
  const window = {
    location: { search: url.search, pathname: url.pathname, hash: url.hash },
    sessionStorage: {
      setItem: (name: string, value: string) => {
        if (options.storageFails) {
          throw new Error('SecurityError')
        }
        stored[name] = value
      },
    },
    history: {
      state: null as unknown,
      replaceState: (_state: unknown, _title: string, next: string) => {
        address = next
      },
    },
  }
  // eslint-disable-next-line no-new-func
  new Function('window', 'URLSearchParams', BOOKING_KEY_KEEPER_SOURCE)(window, URLSearchParams)
  return { stored, address }
}

const structure = (uidl: Record<string, unknown>): ProjectPluginStructure =>
  ({
    uidl: { globals: { env: {}, assets: [{ type: 'script', path: '/pixel.js' }] }, ...uidl },
    files: new Map(),
    dependencies: {},
    devDependencies: {},
  } as unknown as ProjectPluginStructure)

const READS_KEPT_KEY = {
  workflows: {
    w1: {
      nodes: [{ config: { code: `sessionStorage.getItem("${BOOKING_KEY_STORAGE_PREFIX}" + r)` } }],
    },
  },
}

describe('the booking key keeper script', () => {
  it('keeps the key of a /booking/<reference> link and takes it out of the address', () => {
    const { stored, address } = keep(
      'https://site.test/booking/BK-7Q2X9ZK4MA?key=9F3A2b&utm_source=email#top'
    )
    expect(stored).toEqual({ [`${BOOKING_KEY_STORAGE_PREFIX}BK-7Q2X9ZK4MA`]: '9f3a2b' })
    expect(address).toBe('/booking/BK-7Q2X9ZK4MA?utm_source=email#top')
  })

  it('keeps the key of a ?ref= link', () => {
    const { stored, address } = keep('https://site.test/booking?ref=bk-7q2x9zk4ma&key=abc123')
    expect(stored).toEqual({ [`${BOOKING_KEY_STORAGE_PREFIX}BK-7Q2X9ZK4MA`]: 'abc123' })
    expect(address).toBe('/booking?ref=bk-7q2x9zk4ma')
  })

  it('keeps the key the payment return carries in its fragment, in a new tab or browser', () => {
    // A fresh tab: nothing kept yet. The key arrives in the fragment only.
    const { stored, address } = keep('https://site.test/booking/BK-7Q2X9ZK4MA#key=9F3A2b')
    expect(stored).toEqual({ [`${BOOKING_KEY_STORAGE_PREFIX}BK-7Q2X9ZK4MA`]: '9f3a2b' })
    expect(address).toBe('/booking/BK-7Q2X9ZK4MA')
    const query = keep('https://site.test/booking?ref=BK-7Q2X9ZK4MA&payment=success#key=abc&x=1')
    expect(query.stored).toEqual({ [`${BOOKING_KEY_STORAGE_PREFIX}BK-7Q2X9ZK4MA`]: 'abc' })
    expect(query.address).toBe('/booking?ref=BK-7Q2X9ZK4MA&payment=success#x=1')
  })

  it('takes the key out of both the query and the fragment, and keeps any other fragment', () => {
    expect(keep('https://site.test/booking/BK-7Q2X9ZK4MA?key=a#key=a').address).toBe(
      '/booking/BK-7Q2X9ZK4MA'
    )
    expect(keep('https://site.test/booking/BK-7Q2X9ZK4MA?key=a#top').address).toBe(
      '/booking/BK-7Q2X9ZK4MA#top'
    )
  })

  it('leaves every other address alone', () => {
    for (const href of [
      'https://site.test/products/shoe?key=red',
      'https://site.test/booking/BK-7Q2X9ZK4MA',
      'https://site.test/booking?ref=ORDER-1&key=abc',
      'https://site.test/products/shoe#key=red',
    ]) {
      const { stored, address } = keep(href)
      expect(stored).toEqual({})
      const url = new URL(href)
      expect(address).toBe(url.pathname + url.search + url.hash)
    }
  })

  it('leaves the key in the address when the browser refuses storage (the page still reads it)', () => {
    const { address } = keep('https://site.test/booking/BK-7Q2X9ZK4MA?key=abc', {
      storageFails: true,
    })
    expect(address).toBe('/booking/BK-7Q2X9ZK4MA?key=abc')
  })
})

describe('NextBookingProjectPlugin — the key keeper', () => {
  it('ships it as the first script of the head of a site whose booking pages read the kept key', async () => {
    const s = structure({ bookingSettings: { categories: [] as unknown[] }, ...READS_KEPT_KEY })
    const plugin = new NextBookingProjectPlugin()
    await plugin.runBefore(s)
    await plugin.runBefore(s)
    const assets = s.uidl.globals.assets as unknown as Array<Record<string, unknown>>
    expect(assets[0]).toEqual({ type: 'script', content: BOOKING_KEY_KEEPER_SOURCE })
    expect(assets).toHaveLength(2)
    expect(assets[1]).toEqual({ type: 'script', path: '/pixel.js' })
  })

  it('leaves a site without Bookings, or exported by an editor that reads the key from the address, as it was', async () => {
    for (const uidl of [
      READS_KEPT_KEY,
      { bookingSettings: { categories: [] as unknown[] }, workflows: {} },
    ]) {
      const s = structure(uidl)
      await new NextBookingProjectPlugin().runBefore(s)
      expect(s.uidl.globals.assets).toEqual([{ type: 'script', path: '/pixel.js' }])
    }
  })

  it('runs in the emitted _document before any other script of the page — a pixel, the owner’s head code', async () => {
    const s = structure({ bookingSettings: { categories: [] as unknown[] }, ...READS_KEPT_KEY })
    const uidl = s.uidl as unknown as ProjectUIDL
    uidl.globals.assets = [
      {
        type: 'script',
        path: 'https://www.googletagmanager.com/gtag/js?id=G-1',
        options: { async: true },
      },
      { type: 'script', content: 'window.dataLayer = window.dataLayer || [];' },
    ] as never
    ;(uidl.globals as unknown as Record<string, unknown>).customCode = {
      head: '<script>fbq("track", "PageView")</script>',
    }
    ;(uidl as unknown as Record<string, unknown>).name = 'site'
    ;(uidl.globals as unknown as Record<string, unknown>).settings = {
      title: 'Site',
      language: 'en',
    }
    ;(uidl.globals as unknown as Record<string, unknown>).meta = []
    ;(uidl as unknown as Record<string, unknown>).root = {
      name: 'App',
      node: { type: 'element', content: { elementType: 'Router' } },
    }
    await new NextBookingProjectPlugin().runBefore(s)
    const chunks = createDocumentFileChunks(uidl, { assets: {} } as never)
    const source = generate((chunks.js as ChunkDefinition[])[0].content as never).code
    const keeper = source.indexOf('tq-booking-key-keeper')
    expect(keeper).toBeGreaterThan(-1)
    for (const later of ['googletagmanager.com', 'window.dataLayer', 'fbq(']) {
      expect(source.indexOf(later)).toBeGreaterThan(keeper)
    }
  })
})
