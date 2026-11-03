import { ProjectPluginStructure } from '@teleporthq/teleport-types'
import { traverseProjectElements } from '../uidl-element-traversal'
import {
  COOKIE_CONSENT_ACCEPTED,
  COOKIE_CONSENT_KEY,
  LOCAL_STORAGE_WRITE_EVENT,
} from './google-consent-mode'

/**
 * Simple A/B tests (Growth 2.0, spec item 26).
 *
 * An experiment is two SIBLING elements in a page: variant A (the original)
 * and variant B (its copy, edited by the owner), both carrying
 * `data-tq-exp="<id>"` and `data-tq-exp-variant="a"|"b"`. The editor derives
 * the experiment list from those attributes — nothing else is stored — and
 * so does this generator.
 *
 * Both variants are rendered; a tiny inline script in `<head>` picks the
 * visitor's arm BEFORE the body is parsed and hides the other one with a
 * style rule, so there is no flash of two heroes. The rule also hides that
 * element's descendants: a component instance is a `display: contents`
 * wrapper, and `display: none` on the wrapper alone is not enough in every
 * browser.
 *
 * Nothing is stored before the visitor accepts the cookie banner
 * (`cookieConsent` exactly 'accepted', the analytics tracker's own test): the
 * arm is then picked for the page load and held in memory, which client-side
 * navigation keeps; an arm an earlier build stored is removed. With consent
 * the arm is kept in `localStorage` (`tq_exp:<id>`), so a returning visitor
 * sees the same page, and is derived from the analytics visitor id, so the
 * assignment also survives a cleared key. A visitor who accepts on the page
 * keeps the version they are looking at. Only localStorage, no cookies, no
 * cross-site identifier (spec §12).
 *
 * The script publishes `window.__tpExp = { <id>: 'a'|'b' }` for every
 * experiment in the project, each assigned on its own. The tracker stamps
 * `exp` only for tests whose element the visitor has seen (and keeps that
 * arm on later pages, so a checkout still counts for the hero that led
 * there). Analytics → Experiments reads one result per id.
 */
export const EXPERIMENT_ATTR = 'data-tq-exp'
export const EXPERIMENT_VARIANT_ATTR = 'data-tq-exp-variant'
export const EXPERIMENT_STORAGE_PREFIX = 'tq_exp:'

/** The attribute values the generator will act on: an id the stamp can carry. */
const EXPERIMENT_ID_PATTERN = /^[a-z0-9_-]{1,32}$/

/** Every experiment id a page or component of the project declares, sorted, unique. */
export function collectExperimentIds(uidl: ProjectPluginStructure['uidl']): string[] {
  const ids = new Set<string>()
  traverseProjectElements(uidl, (element) => {
    const attr = element.attrs?.[EXPERIMENT_ATTR]
    const id = attr && attr.type === 'static' ? attr.content : null
    if (typeof id === 'string' && EXPERIMENT_ID_PATTERN.test(id)) {
      ids.add(id)
    }
  })
  return Array.from(ids).sort()
}

/**
 * The assignment script. Kept small (well under 1 KB) and dependency-free:
 * it runs in `<head>` of every page, before any bundle. `E` is the list of
 * experiment ids baked in at generation.
 *
 * Arm choice, with consent: the stored arm; else, with a visitor id, the
 * parity of a 32-bit FNV-1a hash of `<visitorId>|<id>` (stable per visitor and
 * per experiment — the same person is not always "a"); else a coin flip, and
 * the arm is stored and reused. Without consent: a coin flip, stored only
 * once the banner's Accept writes the consent (the workflow step announces
 * its write with `teleport:local-storage`; another tab's with `storage`), and
 * never over an arm another tab stored first.
 */
export function buildExperimentAssignmentScript(ids: string[]): string {
  return [
    '(function(){',
    'var E=' + JSON.stringify(ids) + ',M={},C="",P="' + EXPERIMENT_STORAGE_PREFIX + '";',
    'function g(k){try{return window.localStorage.getItem(k)}catch(e){}}',
    // `p(k)` without a value removes the key.
    'function p(k,v){try{v?window.localStorage.setItem(k,v):window.localStorage.removeItem(k)}catch(e){}}',
    'function c(){return g("' + COOKIE_CONSENT_KEY + '")==="' + COOKIE_CONSENT_ACCEPTED + '"}',
    'function h(s){var x=2166136261;for(var i=0;i<s.length;i++){x^=s.charCodeAt(i);x=Math.imul(x,16777619)}return x>>>0}',
    'var K=c();',
    'for(var i=0;i<E.length;i++){var id=E[i],k=P+id,v=K?g(k):p(k);',
    'if(v!=="a"&&v!=="b"){var a=K&&g("tp_aid");v=a?(h(a+"|"+id)&1?"b":"a"):(Math.random()<0.5?"a":"b");if(K)p(k,v)}',
    'M[id]=v;var sel="[' +
      EXPERIMENT_ATTR +
      '=\\""+id+"\\"][' +
      EXPERIMENT_VARIANT_ATTR +
      '=\\""+(v==="a"?"b":"a")+"\\"]";C+=sel+","+sel+" *{display:none!important}"}',
    'window.__tpExp=M;',
    'function A(){if(c())for(i=0;i<E.length;i++)if(!/^[ab]$/.test(g(P+E[i])))p(P+E[i],M[E[i]])}',
    'if(!K){window.addEventListener("' +
      LOCAL_STORAGE_WRITE_EVENT +
      '",A);window.addEventListener("storage",A)}',
    'if(C){var s=document.createElement("style");s.textContent=C;document.head.appendChild(s)}',
    '})();',
  ].join('')
}

/** The `<script>` tag for the project's `customCode.head`; empty without experiments. */
export function buildExperimentHeadSnippet(ids: string[]): string {
  if (ids.length === 0) {
    return ''
  }
  return `<script>${buildExperimentAssignmentScript(ids)}</script>`
}
