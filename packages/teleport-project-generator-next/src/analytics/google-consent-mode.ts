import { ProjectUIDL } from '@teleporthq/teleport-types'

const GOOGLE_TAG_HOST = 'googletagmanager.com'
const DATA_LAYER_GLOBAL = 'dataLayer'

export const COOKIE_CONSENT_KEY = 'cookieConsent'
export const COOKIE_CONSENT_ACCEPTED = 'accepted'

/**
 * Dispatched on `window` by the `storage-local-set` / `storage-local-remove`
 * workflow steps (teleport-plugin-next-workflows). A write in the visitor's own
 * tab fires no `storage` event, and the cookie banner's Accept is such a write.
 */
export const LOCAL_STORAGE_WRITE_EVENT = 'teleport:local-storage'

/**
 * True when the project loads a Google Analytics tag or a Tag Manager
 * container — script assets the editor's project mapper builds from the
 * merchant's ids — or anything else that writes `window.dataLayer`.
 */
export function loadsGoogleTag(uidl: Pick<ProjectUIDL, 'globals'>): boolean {
  const assets = uidl.globals?.assets ?? []
  return assets.some((asset) => {
    if (asset.type !== 'script') {
      return false
    }
    const path = 'path' in asset && typeof asset.path === 'string' ? asset.path : ''
    const content = 'content' in asset && typeof asset.content === 'string' ? asset.content : ''
    return path.indexOf(GOOGLE_TAG_HOST) !== -1 || content.indexOf(DATA_LAYER_GLOBAL) !== -1
  })
}

/**
 * True when a workflow can store the visitor's Accept: the cookie banner's
 * Accept button. Without one nothing could ever grant consent, so a site with
 * an Accept-less banner (or none) keeps its Google tags as they were.
 */
export function hasCookieBannerAccept(uidl: Pick<ProjectUIDL, 'workflows'>): boolean {
  const workflows = Object.values(uidl.workflows?.workflows ?? {})
  return workflows.some((workflow) =>
    (workflow.nodes ?? []).some(
      (node) =>
        node.type === 'storage-local-set' &&
        node.config?.key === COOKIE_CONSENT_KEY &&
        node.config?.value === COOKIE_CONSENT_ACCEPTED
    )
  )
}

export function needsGoogleConsentMode(uidl: Pick<ProjectUIDL, 'globals' | 'workflows'>): boolean {
  return loadsGoogleTag(uidl) && hasCookieBannerAccept(uidl)
}

/**
 * Google Consent Mode v2 for a site with a cookie banner. Runs in `<head>`,
 * before the Google tag and the Tag Manager container (both in `<body>`), so
 * their first look at `dataLayer` finds the default. A visitor who already
 * accepted starts granted; one who accepts on this page is granted at once,
 * with no reload. Commands must be pushed as `arguments` objects — Google's
 * tags ignore plain arrays.
 */
export const GOOGLE_CONSENT_MODE_SOURCE = `(function () {
  window.dataLayer = window.dataLayer || []
  function gtag() {
    window.dataLayer.push(arguments)
  }
  function hasAccepted() {
    try {
      return window.localStorage.getItem('${COOKIE_CONSENT_KEY}') === '${COOKIE_CONSENT_ACCEPTED}'
    } catch (error) {
      return false
    }
  }
  function consentState(granted) {
    var value = granted ? 'granted' : 'denied'
    return {
      ad_storage: value,
      ad_user_data: value,
      ad_personalization: value,
      analytics_storage: value
    }
  }
  var granted = hasAccepted()
  var defaults = consentState(granted)
  if (!granted) {
    defaults.wait_for_update = 500
  }
  gtag('consent', 'default', defaults)
  function syncConsent() {
    var accepted = hasAccepted()
    if (accepted !== granted) {
      granted = accepted
      gtag('consent', 'update', consentState(accepted))
    }
  }
  window.addEventListener('${LOCAL_STORAGE_WRITE_EVENT}', syncConsent)
  window.addEventListener('storage', syncConsent)
})()`
