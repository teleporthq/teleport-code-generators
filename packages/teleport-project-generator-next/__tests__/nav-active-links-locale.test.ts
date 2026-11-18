/**
 * The generated `components/nav-active-links.js` marks the menu link of the page
 * the visitor is on. On a site with several languages the rendered links carry
 * the language prefix (`/es/classes`) while `router.asPath` never does
 * (`/classes`). Comparing the two as plain strings marked NO menu link on any
 * translated page and marked the default language's link in the language
 * switcher as the current page on every one of them.
 */

import { moduleBody } from './_helpers/load-client-runtime'
import { NAV_ACTIVE_LINK_COMPONENT_SOURCE } from '../src/nav-active-link/nav-active-link-component'

interface FakeAnchor {
  label: string
  getAttribute: (name: string) => string | null
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
  querySelectorAll: () => FakeAnchor[]
  classList: { add: (name: string) => void; remove: (name: string) => void }
  isMarked: () => boolean
}

const link = (label: string, href: string, markedBefore = false): FakeAnchor => {
  const attributes = new Map<string, string>([['href', href]])
  const classes = new Set<string>()
  if (markedBefore) {
    attributes.set('aria-current', 'page')
    classes.add('active')
  }
  return {
    label,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => {
      attributes.set(name, value)
    },
    removeAttribute: (name) => {
      attributes.delete(name)
    },
    querySelectorAll: () => [],
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    isMarked: () => attributes.get('aria-current') === 'page' && classes.has('active'),
  }
}

interface FakeRoute {
  asPath: string
  locale?: string
  locales?: string[]
  defaultLocale?: string
}

const markedLinks = (route: FakeRoute, links: FakeAnchor[]): string[] => {
  const navigation = { querySelectorAll: () => links }
  const documentFake = { querySelectorAll: () => [navigation] }
  const router = { ...route, events: { on: (): void => undefined, off: (): void => undefined } }
  const runEffectAtOnce = (effect: () => void) => {
    effect()
  }

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const NavActiveLinks = new Function(
    'useEffect',
    'useRouter',
    'document',
    `${moduleBody(
      NAV_ACTIVE_LINK_COMPONENT_SOURCE.replace(/^export default .*$/m, '')
    )}\nreturn NavActiveLinks`
  )(runEffectAtOnce, () => router, documentFake) as () => null
  NavActiveLinks()

  return links.filter((anchor) => anchor.isMarked()).map((anchor) => anchor.label)
}

/**
 * The same component with the browser's change watcher: what it does when elements are added to
 * the page after it marked the links.
 */
const mountOnAChangingPage = (route: FakeRoute, firstLinks: FakeAnchor[]) => {
  let links = firstLinks
  let passes = 0
  let onChange: (records: Array<{ addedNodes: unknown[] }>) => void = () => undefined
  let nextFrame: (() => void) | null = null
  const navigation = { querySelectorAll: () => links }
  const documentFake = {
    body: {},
    querySelectorAll: () => {
      passes += 1
      return [navigation]
    },
  }
  const router = { ...route, events: { on: (): void => undefined, off: (): void => undefined } }
  class FakeObserver {
    constructor(callback: typeof onChange) {
      onChange = callback
    }
    observe(): void {
      return undefined
    }
    disconnect(): void {
      return undefined
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const NavActiveLinks = new Function(
    'useEffect',
    'useRouter',
    'document',
    'MutationObserver',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    `${moduleBody(
      NAV_ACTIVE_LINK_COMPONENT_SOURCE.replace(/^export default .*$/m, '')
    )}\nreturn NavActiveLinks`
  )(
    (effect: () => void) => {
      effect()
    },
    () => router,
    documentFake,
    FakeObserver,
    (callback: () => void) => {
      nextFrame = callback
      return 1
    },
    (): void => undefined
  ) as () => null
  NavActiveLinks()

  return {
    /** The page puts these elements in; the next frame runs. */
    add: (added: unknown[], linksAfter: FakeAnchor[] = links) => {
      links = linksAfter
      onChange([{ addedNodes: added }])
      const frame = nextFrame
      nextFrame = null
      if (frame) {
        frame()
      }
    },
    marked: () => links.filter((anchor) => anchor.isMarked()).map((anchor) => anchor.label),
    passes: () => passes,
  }
}

const asAddedElement = (anchor: FakeAnchor) => ({ ...anchor, nodeType: 1, tagName: 'A' })
const addedBlock = (holdsALink: boolean) => ({
  nodeType: 1,
  tagName: 'DIV',
  querySelector: () => (holdsALink ? {} : null),
})

const TWO_LANGUAGES = { locales: ['en', 'es'], defaultLocale: 'en' }

describe('generated nav-active-links on a site with several languages', () => {
  it('marks the page link on a page in the default language', () => {
    const marked = markedLinks({ asPath: '/classes', locale: 'en', ...TWO_LANGUAGES }, [
      link('Home', '/'),
      link('Classes', '/classes'),
      link('Pricing', '/pricing'),
      link('switch to en', '/classes'),
      link('switch to es', '/es/classes'),
    ])

    expect(marked).toEqual(['Classes', 'switch to en'])
  })

  it('marks the page link on a translated page, and never the other language', () => {
    const marked = markedLinks({ asPath: '/classes', locale: 'es', ...TWO_LANGUAGES }, [
      link('Inicio', '/es'),
      link('Clases', '/es/classes'),
      link('Precios', '/es/pricing'),
      link('switch to en', '/classes'),
      link('switch to es', '/es/classes'),
    ])

    expect(marked).toEqual(['Clases', 'switch to es'])
  })

  it('marks the home link on a translated home page', () => {
    const marked = markedLinks({ asPath: '/', locale: 'es', ...TWO_LANGUAGES }, [
      link('Inicio', '/es'),
      link('Clases', '/es/classes'),
      link('switch to en', '/'),
      link('switch to es', '/es'),
    ])

    expect(marked).toEqual(['Inicio', 'switch to es'])
  })

  it('removes the mark a link kept from the language the visitor just left', () => {
    const marked = markedLinks({ asPath: '/', locale: 'es', ...TWO_LANGUAGES }, [
      link('switch to en', '/', true),
      link('switch to es', '/es'),
    ])

    expect(marked).toEqual(['switch to es'])
  })

  it('treats a link written with the default language prefix as that language', () => {
    const marked = markedLinks({ asPath: '/classes', locale: 'en', ...TWO_LANGUAGES }, [
      link('Classes', '/en/classes'),
      link('Clases', '/es/classes'),
    ])

    expect(marked).toEqual(['Classes'])
  })

  it('leaves query strings, hashes and trailing slashes out of the comparison', () => {
    const marked = markedLinks({ asPath: '/classes?level=1#top', locale: 'es', ...TWO_LANGUAGES }, [
      link('Clases', '/es/classes/'),
      link('Precios', '/es/pricing'),
    ])

    expect(marked).toEqual(['Clases'])
  })
})

describe('generated nav-active-links on a site with one language', () => {
  it('marks the page link as before', () => {
    const marked = markedLinks({ asPath: '/classes' }, [
      link('Home', '/'),
      link('Classes', '/classes'),
      link('External', 'https://example.com/classes'),
      link('Anchor', '#classes'),
    ])

    expect(marked).toEqual(['Classes'])
  })

  it('does not read a page address as a language', () => {
    const marked = markedLinks({ asPath: '/es/menu' }, [
      link('Menu', '/es/menu'),
      link('Other', '/menu'),
    ])

    expect(marked).toEqual(['Menu'])
  })
})

describe('generated nav-active-links on a page that changes after it loaded', () => {
  const spanishHome = { asPath: '/', locale: 'es', locales: ['en', 'es'], defaultLocale: 'en' }

  it('marks a menu the page builds again, as a page does when the language is switched', () => {
    const page = mountOnAChangingPage(spanishHome, [
      link('Inicio', '/es'),
      link('Clases', '/es/classes'),
    ])
    expect(page.marked()).toEqual(['Inicio'])

    const rebuilt = [
      link('Inicio', '/es'),
      link('Clases', '/es/classes'),
      link('switch to es', '/es'),
    ]
    page.add([addedBlock(true)], rebuilt)

    expect(page.marked()).toEqual(['Inicio', 'switch to es'])
  })

  it('marks a link added on its own', () => {
    const page = mountOnAChangingPage(spanishHome, [link('Clases', '/es/classes')])
    const home = link('Inicio', '/es')

    page.add([asAddedElement(home)], [link('Clases', '/es/classes'), home])

    expect(page.marked()).toEqual(['Inicio'])
  })

  it('does not look at the links again for changes that add none', () => {
    const page = mountOnAChangingPage(spanishHome, [link('Inicio', '/es')])
    const passesAfterLoad = page.passes()

    page.add([{ nodeType: 3 }])
    page.add([addedBlock(false)])

    expect(page.passes()).toBe(passesAfterLoad)
  })
})
