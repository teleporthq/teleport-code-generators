// Source of the generated `components/analytics/AnalyticsTracker.js` —
// null-rendering component that boots the tracker and bridges Next.js
// pages-router navigation events to pageview/page_leave tracking.
export const TRACKER_COMPONENT_SOURCE = `import { useEffect } from 'react'
import { useRouter } from 'next/router'
import {
  initTeleportAnalytics,
  trackRouteChange,
  trackRouteLeave,
} from '../../lib/teleport-analytics'

const AnalyticsTracker = () => {
  const router = useRouter()

  useEffect(() => {
    initTeleportAnalytics()

    const handleRouteChangeStart = () => trackRouteLeave()
    const handleRouteChangeComplete = () => trackRouteChange()

    router.events.on('routeChangeStart', handleRouteChangeStart)
    router.events.on('routeChangeComplete', handleRouteChangeComplete)

    return () => {
      router.events.off('routeChangeStart', handleRouteChangeStart)
      router.events.off('routeChangeComplete', handleRouteChangeComplete)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}

export default AnalyticsTracker
`
