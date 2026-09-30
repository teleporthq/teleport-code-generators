/**
 * The store's own checkout pages for the providers whose payment form runs in
 * the buyer's browser on the merchant's domain:
 *
 * - `/pay/paddle?_ptxn=txn_…` — Paddle Checkout. A Paddle transaction is paid
 *   through Paddle.js on a page of an approved domain; Paddle opens the
 *   checkout for `_ptxn` by itself once the page initialises it.
 * - `/pay/razorpay?subscription=sub_…` — Razorpay Checkout authorising a
 *   subscription, the only Razorpay flow that returns the buyer to the store.
 *
 * Each page asks the store's payment driver (server side, never exposing a
 * secret) for what it needs: the PUBLIC client token or key id, the sandbox
 * flag, and where the buyer goes afterwards. An id the provider does not know
 * is a 404.
 */

const pageShell = (
  title: string,
  script: string
): string => `import { useEffect, useState } from 'react'

${script}

export default function PaymentPage(props) {
  const [failed, setFailed] = useState(false)
  useEffect(function () {
    openCheckout(props, function () {
      setFailed(true)
    })
  }, [])
  return (
    <main style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'inherit' }}>
      <p>{failed ? 'The secure checkout could not be opened. Refresh the page to try again.' : ${JSON.stringify(
        title
      )}}</p>
    </main>
  )
}
`

const serverProps = (
  providerId: string,
  idParam: string
): string => `export async function getServerSideProps(context) {
  var drivers = null
  try {
    drivers = require('../../utils/payments')
  } catch (_e) {
    drivers = null
  }
  var driver = drivers ? drivers.get('${providerId}') : null
  var page = driver ? await driver.checkoutPage(String(context.query.${idParam} || '')) : null
  if (!page) {
    return { notFound: true }
  }
  return { props: page }
}`

const loadScriptHelper = `function loadScript(src, onLoad, onError) {
  var script = document.createElement('script')
  script.src = src
  script.async = true
  script.onload = onLoad
  script.onerror = onError
  document.head.appendChild(script)
}`

// The addresses come back from the provider, which stored whatever the
// checkout that opened it was given: this page must not send a buyer who just
// paid anywhere but the store itself.
const safeRedirectHelper = `// An address of this store, made absolute (Paddle takes nothing else); any
// other site, a javascript: or data: URL, or an address that does not parse
// becomes the store's home page.
function safeRedirect(url) {
  var origin = window.location.origin
  try {
    var target = new URL(String(url || ''), origin + '/')
    if (target.origin === origin && (target.protocol === 'https:' || target.protocol === 'http:')) {
      return target.href
    }
  } catch (_e) {}
  return origin + '/'
}`

export const generatePaddlePayPage = (): string =>
  pageShell(
    'Opening the secure checkout…',
    `${serverProps('paddle', '_ptxn')}

${loadScriptHelper}

${safeRedirectHelper}

// Paddle.js must be loaded from Paddle's CDN; the sandbox is selected before
// it initialises. Closing the checkout without paying goes back to the store.
function openCheckout(props, onFail) {
  loadScript(
    'https://cdn.paddle.com/paddle/v2/paddle.js',
    function () {
      var Paddle = window.Paddle
      if (!Paddle) {
        onFail()
        return
      }
      if (props.sandbox) {
        Paddle.Environment.set('sandbox')
      }
      var completed = false
      Paddle.Initialize({
        token: props.token,
        checkout: { settings: props.successUrl ? { successUrl: safeRedirect(props.successUrl) } : {} },
        eventCallback: function (event) {
          var name = event && event.name
          if (name === 'checkout.completed') {
            completed = true
          } else if (name === 'checkout.closed' && !completed && props.cancelUrl) {
            window.location.href = safeRedirect(props.cancelUrl)
          }
        },
      })
    },
    onFail
  )
}`
  )

export const generateRazorpayPayPage = (): string =>
  pageShell(
    'Opening the secure checkout…',
    `${serverProps('razorpay', 'subscription')}

${loadScriptHelper}

${safeRedirectHelper}

// Razorpay Checkout authorises the subscription with the PUBLIC key id; the
// store's webhook records the result, so the handler only sends the buyer on.
function openCheckout(props, onFail) {
  loadScript(
    'https://checkout.razorpay.com/v1/checkout.js',
    function () {
      if (!window.Razorpay) {
        onFail()
        return
      }
      var checkout = new window.Razorpay({
        key: props.keyId,
        subscription_id: props.subscriptionId,
        handler: function () {
          window.location.href = safeRedirect(props.successUrl)
        },
        modal: {
          ondismiss: function () {
            if (props.cancelUrl) {
              window.location.href = safeRedirect(props.cancelUrl)
            }
          },
        },
      })
      checkout.open()
    },
    onFail
  )
}`
  )
