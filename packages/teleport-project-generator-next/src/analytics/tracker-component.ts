// Source of the generated `components/analytics/AnalyticsTracker.js` —
// null-rendering component that boots the tracker and bridges Next.js
// pages-router navigation events to pageview/page_leave tracking. The pages
// analytics must skip (`uidl.analytics.disabledPaths`) are baked in at
// generation time; the site's locales come from the router so a prefixed
// address (`/fr/admin-panel`) is matched against the same list.
export const buildTrackerComponentSource = (disabledPaths: string[] = []): string =>
  `import { useEffect } from 'react'
import { useRouter } from 'next/router'
import {
  analyticsIds,
  initTeleportAnalytics,
  resetCommerceView,
  trackCommerceEvent,
  trackCommerceView,
  trackNotFound,
  trackOutcome,
  trackRouteChange,
  trackRouteLeave,
} from '../../lib/teleport-analytics'

const EXCLUDED_PATHS = ${JSON.stringify(disabledPaths)}
// The pages-router mounts the custom not-found page under this pathname
// whatever address the visitor asked for.
const NOT_FOUND_PATHNAME = '/404'

const AnalyticsTracker = () => {
  const router = useRouter()

  useEffect(() => {
    initTeleportAnalytics({ excludedPaths: EXCLUDED_PATHS, locales: router.locales || [] })

    // The commerce funnel is fired from WORKFLOWS (add-to-cart, checkout), whose
    // handlers are serialized function bodies evaluated at runtime — they have no
    // module scope and cannot import anything. A global is the only channel they
    // can reach, so the tracker publishes one here.
    //
    // Callers guard with "window.tpTrackCommerce && window.tpTrackCommerce(...)",
    // so a project with analytics disabled (where this component is never
    // emitted) simply does nothing instead of throwing inside a checkout.
    window.tpTrackCommerce = trackCommerceEvent
    // Outcomes (a lead, a sign-up, a search) and the visit's ids, for the same
    // callers: workflow nodes and generated handlers reach them through this.
    window.tpAnalytics = { track: trackOutcome, ids: analyticsIds }

    // A page declares its funnel step with a data attribute (see
    // trackCommerceView). Deferred to the next frame because the marker element
    // is part of the page that is still painting when this effect runs.
    const reportCommerceView = () => {
      window.requestAnimationFrame(() => trackCommerceView())
    }
    const reportNotFound = () => {
      if (router.pathname === NOT_FOUND_PATHNAME) {
        trackNotFound()
      }
    }
    reportCommerceView()
    reportNotFound()

    const handleRouteChangeStart = (url) => trackRouteLeave(url)
    const handleRouteChangeComplete = (url) => {
      trackRouteChange(url)
      // A client-side navigation is a new page load as far as the funnel is
      // concerned, so the once-per-view guard has to be released first.
      resetCommerceView()
      reportCommerceView()
      reportNotFound()
    }

    router.events.on('routeChangeStart', handleRouteChangeStart)
    router.events.on('routeChangeComplete', handleRouteChangeComplete)

    return () => {
      router.events.off('routeChangeStart', handleRouteChangeStart)
      router.events.off('routeChangeComplete', handleRouteChangeComplete)
      // Left in place deliberately on unmount: this component lives in _app for
      // the whole session, and removing the globals during a fast-refresh remount
      // would break any in-flight checkout handler holding a reference to them.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

export default AnalyticsTracker
`

/** The component for a site that tracks every page. */
export const TRACKER_COMPONENT_SOURCE = buildTrackerComponentSource()
