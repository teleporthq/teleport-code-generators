/* tslint:disable:function-constructor */
import generate from '@babel/generator'
import { ChunkDefinition, ProjectUIDL } from '@teleporthq/teleport-types'
import { createDocumentFileChunks } from '../src/utils'
import {
  generateAddressKeyKeeperSource,
  injectAddressKeyKeeper,
  NEWSLETTER_TOKEN_STORAGE_KEY,
  newsletterTokenKeeperPagePaths,
} from '../src/address-key-keeper'

/**
 * A newsletter link's token carries the subscriber's address (base64), and
 * the confirm and unsubscribe pages' analytics or ads tags read
 * `location.href`. The site's one address-key keeper moves `?t=` out of the
 * address on those pages, into the tab's sessionStorage, before any other
 * script of the page runs; the pages' steps read it from there.
 */

const TOKEN =
  'cmVhZGVyQGV4YW1wbGUuY29tfHVuc3Vic2NyaWJlfDE3OTAwMDAwMDA.9xqxAQkmupu1AK9wbvBzMEbua-rdFAsjJHmRS6xrUwk'

/** Runs a keeper against an address; answers what it stored and the address it left. */
const keep = (source: string, href: string) => {
  const url = new URL(href)
  const stored: Record<string, string> = {}
  let address = url.pathname + url.search + url.hash
  const window = {
    location: { search: url.search, pathname: url.pathname, hash: url.hash },
    sessionStorage: {
      setItem: (name: string, value: string) => {
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
  new Function('window', 'URLSearchParams', source)(window, URLSearchParams)
  return { stored, address }
}

const PAGES = ['/newsletter/confirm', '/newsletter/unsubscribe']
const KEEPER = generateAddressKeyKeeperSource({ newsletterPagePaths: PAGES })

/** A project with the newsletter whose pages read the kept token, as the editor builds it. */
const newsletterProject = (extra: Record<string, unknown> = {}): ProjectUIDL =>
  ({
    name: 'site',
    globals: {
      env: {},
      settings: { title: 'Site', language: 'en' },
      meta: [],
      assets: [{ type: 'script', path: 'https://www.googletagmanager.com/gtag/js?id=G-1' }],
      customCode: { head: '<script>fbq("track", "PageView")</script>' },
    },
    root: { name: 'App', node: { type: 'element', content: { elementType: 'Router' } } },
    newsletterSettings: {
      dataSourceId: 'ds-1',
      dataSourceType: 'teleport',
      pages: { confirm: '/newsletter/confirm', unsubscribe: '/newsletter/unsubscribe' },
    },
    workflows: {
      workflows: {
        unsubscribeLoad: {
          nodes: [
            {
              id: 'n1',
              type: 'general-custom-js',
              config: { code: `sessionStorage.getItem("${NEWSLETTER_TOKEN_STORAGE_KEY}")` },
            },
          ],
        },
      },
    },
    ...extra,
  } as unknown as ProjectUIDL)

describe('the newsletter rule of the address-key keeper', () => {
  it('takes the token out of the address of both pages, and keeps it', () => {
    for (const page of PAGES) {
      const { stored, address } = keep(KEEPER, `https://site.test${page}?t=${TOKEN}`)
      expect(stored).toEqual({ [NEWSLETTER_TOKEN_STORAGE_KEY]: TOKEN })
      expect(address).toBe(page)
    }
  })

  it('keeps the rest of the address, and works under a locale, a trailing slash and a fragment', () => {
    expect(
      keep(KEEPER, `https://site.test/newsletter/confirm?utm_source=mail&t=${TOKEN}#top`).address
    ).toBe('/newsletter/confirm?utm_source=mail#top')
    expect(keep(KEEPER, `https://site.test/fr/newsletter/unsubscribe?t=${TOKEN}`)).toEqual({
      stored: { [NEWSLETTER_TOKEN_STORAGE_KEY]: TOKEN },
      address: '/fr/newsletter/unsubscribe',
    })
    expect(keep(KEEPER, `https://site.test/newsletter/confirm/#t=${TOKEN}`).stored).toEqual({
      [NEWSLETTER_TOKEN_STORAGE_KEY]: TOKEN,
    })
  })

  it('leaves every other page alone, whatever its `t` parameter is for', () => {
    for (const href of [
      `https://site.test/blog?t=${TOKEN}`,
      `https://site.test/a/b/newsletter/confirm?t=${TOKEN}`,
      'https://site.test/newsletter/unsubscribe',
    ]) {
      const { stored, address } = keep(KEEPER, href)
      expect(stored).toEqual({})
      const url = new URL(href)
      expect(address).toBe(url.pathname + url.search + url.hash)
    }
  })

  it('is one keeper with the other rules, and is emitted without a backslash', () => {
    const all = generateAddressKeyKeeperSource({
      bookingKeys: true,
      resetPagePaths: ['/reset-password'],
      newsletterPagePaths: PAGES,
    })
    expect(all).not.toContain('\\')
    expect(keep(all, 'https://site.test/reset-password#token=abc').address).toBe('/reset-password')
    expect(keep(all, `https://site.test/newsletter/unsubscribe?t=${TOKEN}`).stored).toEqual({
      [NEWSLETTER_TOKEN_STORAGE_KEY]: TOKEN,
    })
  })
})

describe('the newsletter keeper in a generated project', () => {
  it('ships as the first script of the head of a site whose newsletter pages read the kept token', () => {
    const uidl = newsletterProject()
    injectAddressKeyKeeper(uidl)
    injectAddressKeyKeeper(uidl)
    const assets = uidl.globals.assets as unknown as Array<Record<string, unknown>>
    expect(assets).toHaveLength(2)
    expect(assets[0]).toEqual({ type: 'script', content: KEEPER })

    // In the emitted `_document`: before the owner's tags and custom head code.
    const chunks = createDocumentFileChunks(uidl, { assets: {} } as never)
    const source = generate((chunks.js as ChunkDefinition[])[0].content as never).code
    const keeper = source.indexOf('tq-newsletter-token-keeper')
    expect(keeper).toBeGreaterThan(-1)
    for (const later of ['googletagmanager.com', 'fbq(']) {
      expect(source.indexOf(later)).toBeGreaterThan(keeper)
    }
  })

  it('takes a token from the fragment, as the links sent now carry it', () => {
    expect(keep(KEEPER, `https://site.test/newsletter/unsubscribe#t=${TOKEN}`)).toEqual({
      stored: { [NEWSLETTER_TOKEN_STORAGE_KEY]: TOKEN },
      address: '/newsletter/unsubscribe',
    })
  })

  it('watches the pages the emails link to: their own paths, never an API route', () => {
    expect(
      newsletterTokenKeeperPagePaths(
        newsletterProject({
          newsletterSettings: {
            dataSourceId: 'ds-1',
            dataSourceType: 'teleport',
            pages: { confirm: '/newsletter/confirm1/', unsubscribe: '/api/newsletter/unsubscribe' },
          },
        })
      )
    ).toEqual(['/newsletter/confirm1'])
  })

  it('leaves a site without the newsletter, or whose pages still read the address, as it was', () => {
    for (const uidl of [
      newsletterProject({ workflows: { workflows: { other: { nodes: [] } } } }),
      newsletterProject({ newsletterSettings: undefined }),
      newsletterProject({
        newsletterSettings: { dataSourceId: 'ds-1', dataSourceType: 'postgres', pages: {} },
      }),
    ]) {
      const before = JSON.stringify(uidl.globals.assets)
      injectAddressKeyKeeper(uidl)
      expect(JSON.stringify(uidl.globals.assets)).toBe(before)
    }
  })
})
