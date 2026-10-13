import { PAGE_ARRIVAL_WRAPPER } from './constants'

/**
 * `utils/page-arrival.js` — the wrapper a page's default export goes through
 * when the page computes something on arrival.
 *
 * Next.js keeps a page mounted when a navigation lands on the page that is
 * already on screen: a link to the current URL, another record of the same
 * dynamic route, another query string, another language. The page receives
 * the new props but keeps every `useState` seeded on its first arrival, and no
 * mount effect runs again — so page-load and element-visible workflows stay
 * silent and data-source states keep their old rows until a full reload.
 *
 * The wrapper gives the page a new key for each such arrival, which starts it
 * exactly like a full load does. Only a navigation that STARTED while the page
 * was mounted and ENDED on its own route counts: one that ends elsewhere
 * unmounts the page anyway, and React 17 runs that unmount's effect cleanup
 * after the router has already announced the completed navigation. Shallow
 * navigations (state mirrored into the URL) and hash changes keep the page as
 * it is — they are not arrivals.
 */
export const generatePageArrivalRuntime =
  (): string => `import React, { useEffect, useState } from 'react'
import Router from 'next/router'

function isShallow(options) {
  return !!(options && options.shallow)
}

function usePageArrivals() {
  const [arrivals, setArrivals] = useState(0)

  useEffect(() => {
    const route = Router.pathname
    let arriving = false

    function handleStart(url, options) {
      arriving = !isShallow(options)
    }

    function handleComplete(url, options) {
      const arrived = arriving && !isShallow(options) && Router.pathname === route
      arriving = false
      if (arrived) {
        setArrivals(function (count) {
          return count + 1
        })
      }
    }

    function handleError() {
      arriving = false
    }

    Router.events.on('routeChangeStart', handleStart)
    Router.events.on('routeChangeComplete', handleComplete)
    Router.events.on('routeChangeError', handleError)
    return function () {
      Router.events.off('routeChangeStart', handleStart)
      Router.events.off('routeChangeComplete', handleComplete)
      Router.events.off('routeChangeError', handleError)
    }
  }, [])

  return arrivals
}

export default function ${PAGE_ARRIVAL_WRAPPER}(Page) {
  function PageArrival(props) {
    return <Page key={usePageArrivals()} {...props} />
  }
  PageArrival.displayName = 'PageArrival(' + (Page.displayName || Page.name || 'Page') + ')'
  return PageArrival
}
`
