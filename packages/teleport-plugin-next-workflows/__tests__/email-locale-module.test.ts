import {
  generateEmailLocaleModuleCode,
  resolveEmailLocaleConfig,
  EMAIL_LOCALE_HEADER,
} from '../src/email-locale'

/**
 * The shared locale module decides which language a customer email goes out
 * in and which path a navigation lands on. It is EXECUTED here rather than
 * grepped: every helper must be total (an unknown locale can never select a
 * template that does not exist, nor send a visitor to a locale the app does
 * not serve), and the precedence between the explicit header, the referring
 * page and the Next.js cookie is what keeps a request without the header from
 * silently falling back to the main language.
 */

interface EmailLocaleModule {
  EMAIL_LOCALES: string[]
  DEFAULT_EMAIL_LOCALE: string
  normalizeEmailLocale: (value: unknown) => string | null
  resolveRequestLocale: (req: unknown) => string
  getClientLocale: () => string | null
  localizeHref: (href: unknown, locale: unknown) => unknown
  pickLocalizedTemplate: (
    base: { subject?: string; body?: string },
    localized: unknown,
    locale: unknown
  ) => { subject?: string; body?: string; locale: string }
}

const loadModule = (config: { locales: string[]; defaultLocale: string }): EmailLocaleModule => {
  const code = generateEmailLocaleModuleCode(config)
  const moduleShim = { exports: {} as EmailLocaleModule }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', code)(moduleShim, moduleShim.exports, () => ({}))
  return moduleShim.exports
}

const request = (headers: Record<string, string | string[]>) => ({ headers })

describe('resolveEmailLocaleConfig', () => {
  it('reads the project languages and the main locale off the UIDL', () => {
    const uidl = {
      internationalization: {
        main: { name: 'English', locale: 'en' },
        languages: { en: 'English', es: 'Spanish' },
        translations: {},
      },
    } as any
    expect(resolveEmailLocaleConfig(uidl)).toEqual({ locales: ['en', 'es'], defaultLocale: 'en' })
  })

  it('always lists the main locale, even when the language map omits it', () => {
    const uidl = {
      internationalization: {
        main: { name: 'French', locale: 'fr' },
        languages: { es: 'Spanish' },
        translations: {},
      },
    } as any
    expect(resolveEmailLocaleConfig(uidl)).toEqual({ locales: ['fr', 'es'], defaultLocale: 'fr' })
  })

  it('has no locales at all for a project without internationalization', () => {
    expect(resolveEmailLocaleConfig({} as any)).toEqual({ locales: [], defaultLocale: '' })
  })
})

describe('email-locale module', () => {
  const locales = loadModule({ locales: ['en', 'es', 'pt-BR'], defaultLocale: 'en' })

  describe('normalizeEmailLocale', () => {
    it('answers the canonical code, case-insensitively', () => {
      expect(locales.normalizeEmailLocale('es')).toBe('es')
      expect(locales.normalizeEmailLocale(' ES ')).toBe('es')
      expect(locales.normalizeEmailLocale('pt-br')).toBe('pt-BR')
    })

    it('rejects anything that is not a project locale', () => {
      expect(locales.normalizeEmailLocale('de')).toBeNull()
      expect(locales.normalizeEmailLocale('')).toBeNull()
      expect(locales.normalizeEmailLocale(null)).toBeNull()
      expect(locales.normalizeEmailLocale(42)).toBeNull()
      expect(locales.normalizeEmailLocale({ locale: 'es' })).toBeNull()
    })
  })

  describe('resolveRequestLocale', () => {
    it('prefers the explicit header the client runtime sends', () => {
      expect(
        locales.resolveRequestLocale(
          request({
            [EMAIL_LOCALE_HEADER]: 'es',
            cookie: 'NEXT_LOCALE=pt-BR',
            referer: 'https://shop.example/pt-BR/checkout',
          })
        )
      ).toBe('es')
    })

    it('takes the first value of a repeated header', () => {
      expect(locales.resolveRequestLocale(request({ [EMAIL_LOCALE_HEADER]: ['es', 'en'] }))).toBe(
        'es'
      )
    })

    it('falls back to the locale prefix of the referring page', () => {
      expect(
        locales.resolveRequestLocale(request({ referer: 'https://shop.example/es/cart' }))
      ).toBe('es')
    })

    it('trusts the page the request came from over a stored locale cookie', () => {
      expect(
        locales.resolveRequestLocale(
          request({ cookie: 'session=abc; NEXT_LOCALE=pt-BR; other=1', referer: 'https://x/es/' })
        )
      ).toBe('es')
    })

    it('falls back to the Next.js locale cookie when nothing names the page', () => {
      expect(
        locales.resolveRequestLocale(request({ cookie: 'session=abc; NEXT_LOCALE=pt-BR; other=1' }))
      ).toBe('pt-BR')
    })

    it('reads an unprefixed referring page as the default language', () => {
      expect(locales.resolveRequestLocale(request({ referer: 'https://shop.example/cart' }))).toBe(
        'en'
      )
    })

    it('ignores values that are not project locales and lands on the default', () => {
      expect(
        locales.resolveRequestLocale(
          request({
            [EMAIL_LOCALE_HEADER]: 'de',
            cookie: 'NEXT_LOCALE=fr',
            referer: 'not a url',
          })
        )
      ).toBe('en')
    })

    it('answers the default language for a request without headers', () => {
      expect(locales.resolveRequestLocale(null)).toBe('en')
      expect(locales.resolveRequestLocale({})).toBe('en')
    })
  })

  describe('pickLocalizedTemplate', () => {
    const base = { subject: 'Hello {{name}}', body: '<p>Hi {{name}}</p>' }
    const localized = {
      es: { subject: 'Hola {{name}}', body: '<p>Hola {{name}}</p>' },
      'pt-BR': { body: '<p>Olá {{name}}</p>' },
    }

    it('returns the copy of the requested language', () => {
      expect(locales.pickLocalizedTemplate(base, localized, 'es')).toEqual({
        subject: 'Hola {{name}}',
        body: '<p>Hola {{name}}</p>',
        locale: 'es',
      })
    })

    it('keeps the base subject when the language has no subject of its own', () => {
      expect(locales.pickLocalizedTemplate(base, localized, 'pt-br')).toEqual({
        subject: 'Hello {{name}}',
        body: '<p>Olá {{name}}</p>',
        locale: 'pt-BR',
      })
    })

    it('returns the base copy for the default language', () => {
      expect(locales.pickLocalizedTemplate(base, localized, 'en')).toEqual({
        ...base,
        locale: 'en',
      })
    })

    it('returns the base copy for a language without a copy, an unknown one, or none', () => {
      const expected = { ...base, locale: 'en' }
      expect(locales.pickLocalizedTemplate(base, { es: localized.es }, 'pt-BR')).toEqual(expected)
      expect(locales.pickLocalizedTemplate(base, localized, 'de')).toEqual(expected)
      expect(locales.pickLocalizedTemplate(base, localized, undefined)).toEqual(expected)
      expect(locales.pickLocalizedTemplate(base, null, 'es')).toEqual(expected)
    })

    it('never selects a copy with an empty body', () => {
      expect(
        locales.pickLocalizedTemplate(base, { es: { subject: 'Hola', body: '' } }, 'es')
      ).toEqual({ ...base, locale: 'en' })
    })
  })

  describe('getClientLocale', () => {
    const globalRef = global as unknown as Record<string, unknown>

    const withBrowser = <T>(browser: Record<string, unknown>, run: () => T): T => {
      globalRef.window = browser.window
      globalRef.document = browser.document
      try {
        return run()
      } finally {
        delete globalRef.window
        delete globalRef.document
      }
    }

    it('is inert outside a browser', () => {
      expect(locales.getClientLocale()).toBeNull()
    })

    it('reads the router live, so a client-side language switch is not lost', () => {
      // After `router.push(..., { locale: 'es' })` Next.js updates the router
      // and <html lang>, but the page data keeps the locale the document was
      // served in.
      expect(
        withBrowser(
          {
            window: { next: { router: { locale: 'es' } }, __NEXT_DATA__: { locale: 'en' } },
            document: { documentElement: { lang: 'es' } },
          },
          () => locales.getClientLocale()
        )
      ).toBe('es')
    })

    it('falls back to <html lang>, then to the page data', () => {
      expect(
        withBrowser(
          {
            window: { __NEXT_DATA__: { locale: 'en' } },
            document: { documentElement: { lang: 'es' } },
          },
          () => locales.getClientLocale()
        )
      ).toBe('es')
      expect(
        withBrowser({ window: { __NEXT_DATA__: { locale: 'pt-br' } }, document: {} }, () =>
          locales.getClientLocale()
        )
      ).toBe('pt-BR')
    })

    it('ignores a candidate that is not a project locale', () => {
      expect(
        withBrowser(
          {
            window: { next: { router: { locale: 'de' } } },
            document: { documentElement: { lang: 'x' } },
          },
          () => locales.getClientLocale()
        )
      ).toBeNull()
    })
  })

  describe('localizeHref', () => {
    it('prefixes a site-relative page path with a non-default locale', () => {
      expect(locales.localizeHref('/', 'es')).toBe('/es')
      expect(locales.localizeHref('/sign-in', 'es')).toBe('/es/sign-in')
      expect(locales.localizeHref('/orders/ORD-42?payment=success', 'pt-br')).toBe(
        '/pt-BR/orders/ORD-42?payment=success'
      )
      expect(locales.localizeHref('/?ref=1#top', 'es')).toBe('/es?ref=1#top')
      expect(locales.localizeHref('/products/', 'es')).toBe('/es/products/')
    })

    it('keeps the bare path for the default language, an unknown locale and no locale', () => {
      expect(locales.localizeHref('/sign-in', 'en')).toBe('/sign-in')
      expect(locales.localizeHref('/sign-in', 'de')).toBe('/sign-in')
      expect(locales.localizeHref('/sign-in', undefined)).toBe('/sign-in')
      expect(locales.localizeHref('/sign-in', null)).toBe('/sign-in')
    })

    it('never touches a path that already names a locale', () => {
      expect(locales.localizeHref('/es/cart', 'es')).toBe('/es/cart')
      expect(locales.localizeHref('/es', 'es')).toBe('/es')
      expect(locales.localizeHref('/en/cart', 'es')).toBe('/en/cart')
    })

    it('never touches an API route, a Next.js internal path or a file', () => {
      expect(locales.localizeHref('/api/invoices/download?id=1', 'es')).toBe(
        '/api/invoices/download?id=1'
      )
      expect(locales.localizeHref('/api', 'es')).toBe('/api')
      expect(locales.localizeHref('/_next/static/x.js', 'es')).toBe('/_next/static/x.js')
      expect(locales.localizeHref('/brochure.pdf', 'es')).toBe('/brochure.pdf')
      expect(locales.localizeHref('/sitemap.xml?v=2', 'es')).toBe('/sitemap.xml?v=2')
    })

    it('never touches anything that is not a site-relative path', () => {
      expect(locales.localizeHref('https://shop.example/cart', 'es')).toBe(
        'https://shop.example/cart'
      )
      expect(locales.localizeHref('//cdn.example/x', 'es')).toBe('//cdn.example/x')
      expect(locales.localizeHref('#top', 'es')).toBe('#top')
      expect(locales.localizeHref('mailto:a@b.c', 'es')).toBe('mailto:a@b.c')
      expect(locales.localizeHref('products', 'es')).toBe('products')
      expect(locales.localizeHref('', 'es')).toBe('')
      expect(locales.localizeHref(undefined, 'es')).toBeUndefined()
      expect(locales.localizeHref(42, 'es')).toBe(42)
    })
  })
})

describe('email-locale module without internationalization', () => {
  const none = loadModule({ locales: [], defaultLocale: '' })

  it('recognises no locale and keeps the single template', () => {
    expect(none.normalizeEmailLocale('en')).toBeNull()
    expect(none.resolveRequestLocale(request({ [EMAIL_LOCALE_HEADER]: 'en' }))).toBe('')
    expect(
      none.pickLocalizedTemplate({ subject: 'S', body: 'B' }, { en: { body: 'X' } }, 'en')
    ).toEqual({ subject: 'S', body: 'B', locale: '' })
  })

  it('never prefixes a path', () => {
    expect(none.localizeHref('/sign-in', 'en')).toBe('/sign-in')
    expect(none.localizeHref('/', 'es')).toBe('/')
  })
})
