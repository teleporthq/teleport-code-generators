// Source of the generated `components/nav-active-links.js` — a null-rendering
// client component (mounted once in _app) that marks the navigation link
// matching the CURRENT route as active.
//
// The code generator deliberately emits every nav link with the SAME base
// class and NO hardcoded `active` / `aria-current` — a hardcoded active makes
// one link (e.g. "Taproom"/"Dashboard") look selected on EVERY page. This
// helper adds the `active` class + `aria-current="page"` to the link whose
// href matches the current page and REMOVES it from the others, on first paint
// and on every client-side route change. Removing it from non-matching links
// also self-corrects a link the generator may have accidentally left marked.
//
// It is purely additive: it never touches href/onClick, and the whole pass is
// wrapped in try/catch, so it can never break navigation.
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
            const isActive = linkable && normalizePath(raw) === current
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
    return () => {
      router.events.off('routeChangeComplete', apply)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.asPath])

  return null
}

export default NavActiveLinks
`
