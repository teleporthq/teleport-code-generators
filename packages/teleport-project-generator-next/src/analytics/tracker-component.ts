// Source of the generated `components/analytics/AnalyticsTracker.js` —
// null-rendering component that boots the tracker and bridges Next.js
// pages-router navigation events to pageview/page_leave tracking.
export const TRACKER_COMPONENT_SOURCE = `import { useEffect } from 'react'
import { useRouter } from 'next/router'
import {
  initTeleportAnalytics,
  resetCommerceView,
  trackCommerceEvent,
  trackCommerceView,
  trackRouteChange,
  trackRouteLeave,
} from '../../lib/teleport-analytics'

const AnalyticsTracker = () => {
  const router = useRouter()

  useEffect(() => {
    initTeleportAnalytics()

    // The commerce funnel is fired from WORKFLOWS (add-to-cart, checkout), whose
    // handlers are serialized function bodies evaluated at runtime — they have no
    // module scope and cannot import anything. A global is the only channel they
    // can reach, so the tracker publishes one here.
    //
    // Callers guard with "window.tpTrackCommerce && window.tpTrackCommerce(...)",
    // so a project with analytics disabled (where this component is never
    // emitted) simply does nothing instead of throwing inside a checkout.
    window.tpTrackCommerce = trackCommerceEvent

    // A page declares its funnel step with a data attribute (see
    // trackCommerceView). Deferred to the next frame because the marker element
    // is part of the page that is still painting when this effect runs.
    const reportCommerceView = () => {
      window.requestAnimationFrame(() => trackCommerceView())
    }
    reportCommerceView()

    const handleRouteChangeStart = (url) => trackRouteLeave(url)
    const handleRouteChangeComplete = (url) => {
      trackRouteChange(url)
      // A client-side navigation is a new page load as far as the funnel is
      // concerned, so the once-per-view guard has to be released first.
      resetCommerceView()
      reportCommerceView()
    }

    router.events.on('routeChangeStart', handleRouteChangeStart)
    router.events.on('routeChangeComplete', handleRouteChangeComplete)

    return () => {
      router.events.off('routeChangeStart', handleRouteChangeStart)
      router.events.off('routeChangeComplete', handleRouteChangeComplete)
      // Left in place deliberately on unmount: this component lives in _app for
      // the whole session, and removing the global during a fast-refresh remount
      // would break any in-flight checkout handler holding a reference to it.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

export default AnalyticsTracker
`
