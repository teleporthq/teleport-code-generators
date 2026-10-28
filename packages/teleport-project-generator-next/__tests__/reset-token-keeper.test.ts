/* tslint:disable:function-constructor */
import * as nodeCrypto from 'crypto'
import generate from '@babel/generator'
import { ChunkDefinition, ProjectUIDL } from '@teleporthq/teleport-types'
import { createDocumentFileChunks } from '../src/utils'
import { generateAddressKeyKeeperSource, injectAddressKeyKeeper } from '../src/address-key-keeper'
import { BOOKING_KEY_STORAGE_PREFIX } from '../src/bookings/manage-key-snippet'
import {
  generateResetPasswordRoute,
  RESET_TOKEN_STORAGE_KEY,
} from '../../teleport-plugin-next-workflows/src/password-reset-route-generator'
import {
  isSecurityRuntimeSpecifier,
  loadSecurityRuntime,
} from '../../teleport-plugin-next-workflows/__tests__/_helpers/load-security-runtime'

/**
 * Review fix m2: a password-reset link's token is the account for 30 minutes,
 * and the reset page's analytics or ads tags read `location.href`. The site's
 * one address-key keeper (the booking manage key's, generalised) moves the
 * token out of the address — its fragment (`#token=`, every link sent now) or
 * its query (`?token=`, links already sent) — into the tab's sessionStorage
 * before any other script of the page runs; the reset page's steps read it
 * from there.
 */

const TOKEN = 'ab'.repeat(32)

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

const RESET_KEEPER = generateAddressKeyKeeperSource({ resetPagePaths: ['/reset-password'] })

/** A project whose reset page reads the kept token, as the editor now builds it. */
const resetProject = (extra: Record<string, unknown> = {}): ProjectUIDL =>
  ({
    name: 'site',
    globals: {
      env: {},
      settings: { title: 'Site', language: 'en' },
      meta: [],
      assets: [
        {
          type: 'script',
          path: 'https://www.googletagmanager.com/gtag/js?id=G-1',
          options: { async: true },
        },
      ],
      customCode: { head: '<script>fbq("track", "PageView")</script>' },
    },
    root: { name: 'App', node: { type: 'element', content: { elementType: 'Router' } } },
    authentication: { enabled: true, passwordAuthEnabled: true },
    workflows: {
      workflows: {
        forgot: {
          nodes: [
            {
              id: 'n1',
              type: 'account-request-password-reset',
              config: { resetPagePath: '/reset-password' },
            },
          ],
        },
        resetPage: {
          nodes: [
            {
              id: 'n2',
              type: 'general-custom-js',
              config: { code: `sessionStorage.getItem("${RESET_TOKEN_STORAGE_KEY}")` },
            },
          ],
        },
      },
    },
    ...extra,
  } as unknown as ProjectUIDL)

describe('the reset-token rule of the address-key keeper', () => {
  it('takes the token out of the fragment and out of the query of the reset page, and keeps it', () => {
    for (const href of [
      `https://site.test/reset-password#token=${TOKEN}`,
      `https://site.test/reset-password?token=${TOKEN}`,
    ]) {
      const { stored, address } = keep(RESET_KEEPER, href)
      expect(stored).toEqual({ [RESET_TOKEN_STORAGE_KEY]: TOKEN })
      expect(address).toBe('/reset-password')
    }
  })

  it('keeps the rest of the address, and works under a locale and a trailing slash', () => {
    expect(
      keep(RESET_KEEPER, `https://site.test/reset-password?utm_source=mail&token=${TOKEN}#top`)
        .address
    ).toBe('/reset-password?utm_source=mail#top')
    expect(keep(RESET_KEEPER, `https://site.test/fr/reset-password#token=${TOKEN}&x=1`)).toEqual({
      stored: { [RESET_TOKEN_STORAGE_KEY]: TOKEN },
      address: '/fr/reset-password#x=1',
    })
    expect(keep(RESET_KEEPER, `https://site.test/reset-password/#token=${TOKEN}`).stored).toEqual({
      [RESET_TOKEN_STORAGE_KEY]: TOKEN,
    })
  })

  it('leaves every other page alone, whatever its token parameter is for', () => {
    for (const href of [
      `https://site.test/newsletter/confirm?token=${TOKEN}`,
      `https://site.test/a/b/reset-password?token=${TOKEN}`,
      'https://site.test/reset-password',
    ]) {
      const { stored, address } = keep(RESET_KEEPER, href)
      expect(stored).toEqual({})
      const url = new URL(href)
      expect(address).toBe(url.pathname + url.search + url.hash)
    }
  })

  it('is one keeper with the booking rule: both keys leave, and a booking link reads as before', () => {
    const both = generateAddressKeyKeeperSource({
      bookingKeys: true,
      resetPagePaths: ['/reset-password'],
    })
    expect(keep(both, 'https://site.test/booking/BK-7Q2X9ZK4MA?key=9F3A2b#top')).toEqual({
      stored: { [`${BOOKING_KEY_STORAGE_PREFIX}BK-7Q2X9ZK4MA`]: '9f3a2b' },
      address: '/booking/BK-7Q2X9ZK4MA#top',
    })
    expect(keep(both, `https://site.test/reset-password#token=${TOKEN}`).address).toBe(
      '/reset-password'
    )
  })

  it('the kept token resets the password', async () => {
    const { stored } = keep(RESET_KEEPER, `https://site.test/reset-password#token=${TOKEN}`)
    const spent: string[] = []
    const module = { exports: {} as any }
    const hashPassword: any = (password: string) => 'hash:' + password
    hashPassword.passwordPolicyError = () => null
    const securityRuntime = loadSecurityRuntime()
    new Function(
      'require',
      'module',
      'exports',
      'process',
      'console',
      generateResetPasswordRoute()
    )(
      (id: string): unknown => {
        if (id === 'crypto') {
          return nodeCrypto
        }
        if (isSecurityRuntimeSpecifier(id)) {
          return securityRuntime
        }
        if (id === '../../../utils/auth/hash-password') {
          return hashPassword
        }
        if (id === '../../../utils/auth/auth-options') {
          return {
            consumePasswordReset: async (tokenHash: string) => {
              spent.push(tokenHash)
              return tokenHash === nodeCrypto.createHash('sha256').update(TOKEN).digest('hex')
                ? { id: 'u1', email: 'a@b.c' }
                : null
            },
          }
        }
        throw new Error('unexpected require: ' + id)
      },
      module,
      module.exports,
      { env: { NEXTAUTH_SECRET: 's' } },
      { error: () => undefined, warn: () => undefined, log: () => undefined }
    )
    const reply: any = {}
    const res: any = {
      status(code: number) {
        reply.status = code
        return res
      },
      json(body: unknown) {
        reply.body = body
        return res
      },
      setHeader: () => undefined,
    }
    await module.exports(
      {
        method: 'POST',
        headers: { host: 'site.test' },
        socket: { remoteAddress: '203.0.113.5' },
        body: { token: stored[RESET_TOKEN_STORAGE_KEY], password: 'Brand#New2' },
      },
      res
    )
    expect(reply.body).toEqual({ valid: true, changed: true })
    expect(spent).toHaveLength(1)
  })
})

describe('the keeper in a generated project', () => {
  it('ships as the first script of the head of a site whose reset page reads the kept token', () => {
    const uidl = resetProject()
    injectAddressKeyKeeper(uidl)
    injectAddressKeyKeeper(uidl)
    const assets = uidl.globals.assets as unknown as Array<Record<string, unknown>>
    expect(assets).toHaveLength(2)
    expect(assets[0]).toEqual({ type: 'script', content: RESET_KEEPER })

    const chunks = createDocumentFileChunks(uidl, { assets: {} } as never)
    const source = generate((chunks.js as ChunkDefinition[])[0].content as never).code
    const keeper = source.indexOf('tq-reset-token-keeper')
    expect(keeper).toBeGreaterThan(-1)
    for (const later of ['googletagmanager.com', 'fbq(']) {
      expect(source.indexOf(later)).toBeGreaterThan(keeper)
    }
  })

  it('watches the page the reset email links to', () => {
    const uidl = resetProject()
    ;(uidl.workflows as any).workflows.forgot.nodes[0].config.resetPagePath =
      '/account/new-password'
    injectAddressKeyKeeper(uidl)
    const keeper = String((uidl.globals.assets[0] as { content?: string }).content)
    expect(keep(keeper, `https://site.test/account/new-password#token=${TOKEN}`).address).toBe(
      '/account/new-password'
    )
  })

  it('leaves a site whose reset page still reads the address, or without password sign-in, as it was', () => {
    for (const uidl of [
      resetProject({ workflows: { workflows: { forgot: { nodes: [] } } } }),
      resetProject({ authentication: { enabled: true, passwordAuthEnabled: false } }),
      resetProject({ authentication: undefined }),
    ]) {
      const before = JSON.stringify(uidl.globals.assets)
      injectAddressKeyKeeper(uidl)
      expect(JSON.stringify(uidl.globals.assets)).toBe(before)
    }
  })
})
