// Source of the generated `components/nav-active-links.js` — a null-rendering
// client component (mounted once in _app) that marks the navigation link
// matching the CURRENT route as active.
//
// The code generator deliberately emits every nav link with the SAME base
// class and NO hardcoded `active` / `aria-current` — a hardcoded active makes
// one link (e.g. "Taproom"/"Dashboard") look selected on EVERY page. This
// helper adds the `active` class + `aria-current="page"` to the link whose
// href matches the current page and REMOVES it from the others, on first paint,
// on every client-side route change, and whenever links are added to the page.
// Removing it from non-matching links also self-corrects a link the generator
// may have accidentally left marked.
//
// It is purely additive: it never touches href/onClick, and the whole pass is
// wrapped in try/catch, so it can never break navigation.
//
// On a multi-language site a link is current only when it leads to the page
// the visitor is on IN THE LANGUAGE they are on. `router.asPath` never carries
// the language prefix while a rendered href does (`/es/classes`), so the two
// are compared as { language, path } pairs. Comparing the bare strings marked
// no menu link on any translated page, and marked the default language's link
// in a language switcher as the current page on every one of them.
export const NAV_ACTIVE_LINK_COMPONENT_SOURCE = `import { useEffect } from 'react'
import { useRouter } from 'next/router'

// Containers whose <a> descendants are navigation links.
const NAV_CONTAINERS = 'nav, [role="navigation"], [class*="navigation"], [class*="sidebar"], [class*="navbar"]'
// The visible element the CSS styles as active may be the <a> itself or an
// inner wrapper carrying the shared base class (e.g. <a><div class="navigation-link">).
const ACTIVE_TARGET_TOKENS = ['navigation-link', 'nav-link', 'sidebar-link', 'nav-item', 'menu-item']

function normalizePath(path) {
  if (!path) return '/'
  const clean = path.split('#')[0].split('?')[0]
  const trimmed = clean.replace(/\\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

// '/es/classes' -> { locale: 'es', path: '/classes' }. A path with no language
// prefix is in the default language (undefined on a single-language site).
function splitLocale(path, locales, defaultLocale) {
  const segments = path.split('/')
  if (locales && segments.length > 1 && locales.indexOf(segments[1]) !== -1) {
    return { locale: segments[1], path: normalizePath('/' + segments.slice(2).join('/')) }
  }
  return { locale: defaultLocale, path: path }
}

function collectActiveTargets(anchor) {
  const targets = [anchor]
  const descendants = anchor.querySelectorAll('*')
  for (let i = 0; i < descendants.length; i++) {
    const el = descendants[i]
    const tokens = (el.getAttribute('class') || '').split(/\\s+/)
    for (let t = 0; t < tokens.length; t++) {
      if (ACTIVE_TARGET_TOKENS.indexOf(tokens[t]) !== -1) {
        targets.push(el)
        break
      }
    }
  }
  return targets
}

const NavActiveLinks = () => {
  const router = useRouter()

  useEffect(() => {
    const apply = () => {
      try {
        const current = normalizePath(router.asPath)
        const seen = new Set()
        const containers = document.querySelectorAll(NAV_CONTAINERS)
        containers.forEach((container) => {
          const anchors = container.querySelectorAll('a[href]')
          anchors.forEach((anchor) => {
            if (seen.has(anchor)) return
            seen.add(anchor)
            const raw = anchor.getAttribute('href') || ''
            const linkable = raw && raw.charAt(0) !== '#' && !/^(https?:|mailto:|tel:)/i.test(raw)
            const target = linkable
              ? splitLocale(normalizePath(raw), router.locales, router.defaultLocale)
              : null
            const isActive = !!target && target.path === current && target.locale === router.locale
            const targets = collectActiveTargets(anchor)
            targets.forEach((el) => {
              if (isActive) {
                el.classList.add('active')
              } else {
                el.classList.remove('active')
              }
            })
            if (isActive) {
              anchor.setAttribute('aria-current', 'page')
            } else if (anchor.getAttribute('aria-current') === 'page') {
              anchor.removeAttribute('aria-current')
            }
          })
        })
      } catch (err) {
        // Highlighting is best-effort — never let it break the page.
      }
    }

    apply()
    router.events.on('routeChangeComplete', apply)

    // Links can be put on the page after this ran: a page that is built again
    // when the visitor reaches it again (a language switch, another item of the
    // same page), a menu drawn only when it opens. Whenever links are added,
    // mark them, once per frame at most. Marking changes classes and attributes
    // only, never the elements, so it cannot call itself.
    let frame = 0
    const addsLinks = (records) => {
      for (let r = 0; r < records.length; r++) {
        const added = records[r].addedNodes
        for (let n = 0; n < added.length; n++) {
          const node = added[n]
          if (node.nodeType === 1 && (node.tagName === 'A' || node.querySelector('a[href]'))) {
            return true
          }
        }
      }
      return false
    }
    const observer =
      typeof MutationObserver === 'function'
        ? new MutationObserver((records) => {
            if (!frame && addsLinks(records)) {
              frame = requestAnimationFrame(() => {
                frame = 0
                apply()
              })
            }
          })
        : null
    if (observer) {
      observer.observe(document.body, { childList: true, subtree: true })
    }

    return () => {
      router.events.off('routeChangeComplete', apply)
      if (observer) {
        observer.disconnect()
      }
      if (frame) {
        cancelAnimationFrame(frame)
      }
    }
    // A language switch keeps asPath and changes only the locale; the links it
    // re-renders must be marked again once they are on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.asPath, router.locale])

  return null
}

export default NavActiveLinks
`
