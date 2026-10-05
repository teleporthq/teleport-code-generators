import { UIDLGlobalProjectValues } from '@teleporthq/teleport-types'

/**
 * Keeps an error thrown by the project's OWN inline scripts from surfacing as an
 * unhandled error of the generated app.
 *
 * The project's custom code (Project settings → Custom code) and its inline
 * script assets are pasted into the document as inline `<script>`s. When one of
 * them throws — a custom accordion script calling `addEventListener` on a header
 * the markup no longer has — the browser reports the error as uncaught, and the
 * generated app's development server (Next.js) covers the page with its error
 * overlay, on every page and again after every navigation. The app is fine; the
 * script is not.
 *
 * An inline script reports the URL of the document it was parsed with as its
 * file, both for an error thrown while it runs and for one thrown later by a
 * callback it registered; the app's bundles and external scripts report their
 * own URLs. The guard is the first script of the document, so its capture
 * listener runs before every other `error` listener (the overlay's included):
 * it stops such an error there and logs it as a warning instead. The scripts
 * themselves are not wrapped or rewritten, so a top-level declaration one script
 * shares with the next keeps working.
 */
export const INLINE_SCRIPT_ERROR_GUARD = `(function () {
  var documentUrl = String(document.URL).split('#')[0]
  window.addEventListener(
    'error',
    function (event) {
      if (!event.error || String(event.filename || '').split('#')[0] !== documentUrl) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      console.warn('A custom code script on this page failed:', event.error)
    },
    true
  )
})()`

const SCRIPT_TAG = /<script\b/i

/**
 * Whether the document runs scripts the project wrote itself — the only case the
 * guard is emitted in, so a project without any comes out exactly as before.
 */
export const documentRunsProjectScripts = (
  globals: Pick<UIDLGlobalProjectValues, 'customCode' | 'assets'>
): boolean =>
  SCRIPT_TAG.test(globals.customCode?.head || '') ||
  SCRIPT_TAG.test(globals.customCode?.body || '') ||
  (globals.assets || []).some((asset) => asset.type === 'script' && 'content' in asset)
