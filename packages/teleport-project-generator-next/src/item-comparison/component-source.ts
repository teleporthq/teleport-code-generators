import { toJsLiteral } from '../pwa/source-literals'
import { ITEM_COMPARISON_STYLES } from './component-styles'
import { COMPARE_ROUTE } from './compare-route'
import { COMPARE_KINDS, ItemComparisonConfig } from './settings'

export const ITEM_COMPARISON_COMPONENT_FILE = 'teleport-item-comparison'
export const ITEM_COMPARISON_COMPONENT_NAME = 'TeleportItemComparison'
/** The editor's marks and events (`features/plugins/flows/item-comparison/compare-markers.ts` there). */
const COMPARE_TOGGLE_MARKER = 'data-tq-compare-toggle'
const COMPARE_REMOVE_MARKER = 'data-tq-compare-remove'
const COMPARE_CLEAR_MARKER = 'data-tq-compare-clear'
const COMPARE_KIND_ATTR = 'data-tq-compare-kind'
const ITEM_ID_ATTR = 'data-item-id'
const EVENT_PREFIX = 'workflow:custom:'
const TOGGLE_EVENT_PREFIX = 'tq-compare-toggle:'
const REMOVE_EVENT = 'tq-compare-remove'
const CLEAR_EVENT = 'tq-compare-clear'
const REQUEST_EVENT = 'tq-compare-request'
const FOLD_EVENT = 'tq-compare-fold'
const UNFOLD_EVENT = 'tq-compare-unfold'
const ITEMS_EVENT = 'tq-compare-items'
/** The editor's phone breakpoint: the tray starts folded up to it. */
const PHONE_QUERY = '(max-width: 767px)'

/**
 * `components/teleport-item-comparison.js`, rendered once from `_app`: the
 * keeper of the visitor's comparison. The controls the editor built — the
 * Compare buttons, the tray's and the page's Remove and Clear — send custom
 * events through their workflows; this keeps the picks (one kind at a time,
 * capped) in the visitor's browser, marks the Compare buttons pressed, reads
 * the picked rows through the compare route and answers the page's and the
 * tray's workflows with `tq-compare-items`: the items with their attribute
 * rows (the best value marked, the shared attributes left out when the
 * owner asked), the rows of their custom properties, the tray's slots (the
 * picks, then free slots), whether the tray shows on this page and whether
 * it is open or folded into its round button — open on a wide screen, folded
 * on a phone, until the visitor folds or opens it (`tq-compare-fold` /
 * `tq-compare-unfold`, kept for the visit).
 * A toast tells a visitor when the comparison is full. Nothing here is drawn
 * but the toast; the tray and the page are the project's own components.
 */
export const buildItemComparisonComponentSource = (config: ItemComparisonConfig): string => {
  const client = {
    maxItems: config.maxItems,
    highlightBest: config.highlightBest,
    onlyDifferences: config.onlyDifferences,
    compareRoute: config.compareRoute,
    propertyRows: {
      products: config.productPropertyRows,
      bookingItems: config.bookingPropertyRows,
    },
    properties: { products: config.productProperties, bookingItems: config.bookingProperties },
  }
  return `import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'

const SETTINGS = ${toJsLiteral(client)}
const COMPARE_ROUTE = ${toJsLiteral(COMPARE_ROUTE)}
const TOGGLE_SELECTOR = ${toJsLiteral(`[${COMPARE_TOGGLE_MARKER}]`)}
const REMOVE_SELECTOR = ${toJsLiteral(`[${COMPARE_REMOVE_MARKER}]`)}
const CLEAR_SELECTOR = ${toJsLiteral(`[${COMPARE_CLEAR_MARKER}]`)}
const KIND_ATTR = ${toJsLiteral(COMPARE_KIND_ATTR)}
const ID_ATTR = ${toJsLiteral(ITEM_ID_ATTR)}
const EVENT_PREFIX = ${toJsLiteral(EVENT_PREFIX)}
const TOGGLE_EVENT_PREFIX = ${toJsLiteral(TOGGLE_EVENT_PREFIX)}
const REMOVE_EVENT = ${toJsLiteral(REMOVE_EVENT)}
const CLEAR_EVENT = ${toJsLiteral(CLEAR_EVENT)}
const REQUEST_EVENT = ${toJsLiteral(REQUEST_EVENT)}
const FOLD_EVENT = ${toJsLiteral(FOLD_EVENT)}
const UNFOLD_EVENT = ${toJsLiteral(UNFOLD_EVENT)}
const ITEMS_EVENT = ${toJsLiteral(ITEMS_EVENT)}
const PHONE_QUERY = ${toJsLiteral(PHONE_QUERY)}
const KINDS = ${toJsLiteral(COMPARE_KINDS)}
const STORE_KEY = 'tq_compare'
const TRAY_KEY = 'tq_compare_tray'
const CHANGE_EVENT = 'tq-compare:change'
const STYLES = ${toJsLiteral(ITEM_COMPARISON_STYLES)}
const BEST_LABEL = 'Best'
const MAX_CUSTOM_ROWS = 30

function readPicks() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null')
    if (parsed && KINDS.indexOf(parsed.kind) >= 0 && Array.isArray(parsed.ids)) {
      return { kind: parsed.kind, ids: parsed.ids.filter((id) => typeof id === 'string').slice(0, SETTINGS.maxItems) }
    }
  } catch (e) {}
  return { kind: null, ids: [] }
}

// False when the browser keeps nothing (storage blocked or full): nothing changed, nothing is announced.
function writePicks(picks) {
  try {
    if (picks.ids.length === 0) window.localStorage.removeItem(STORE_KEY)
    else window.localStorage.setItem(STORE_KEY, JSON.stringify(picks))
  } catch (e) {
    return false
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  return true
}

// The visitor's fold or open, for this visit; kept in memory too when the browser keeps nothing.
let trayChoiceMade = null
function trayChoice() {
  try {
    const stored = window.sessionStorage.getItem(TRAY_KEY)
    if (stored === 'open' || stored === 'folded') return stored
  } catch (e) {}
  return trayChoiceMade
}

function chooseTray(choice) {
  trayChoiceMade = choice
  try {
    window.sessionStorage.setItem(TRAY_KEY, choice)
  } catch (e) {}
}

// Open on a wide screen, folded on a phone — until the visitor chooses.
function trayOpen() {
  const choice = trayChoice()
  if (choice) return choice === 'open'
  return !(window.matchMedia && window.matchMedia(PHONE_QUERY).matches)
}

function syncToggles(picks) {
  const toggles = document.querySelectorAll(TOGGLE_SELECTOR)
  for (let i = 0; i < toggles.length; i++) {
    const toggle = toggles[i]
    const pressed = toggle.getAttribute(KIND_ATTR) === picks.kind && picks.ids.indexOf(toggle.getAttribute(ID_ATTR)) >= 0
    toggle.setAttribute('aria-pressed', pressed ? 'true' : 'false')
  }
}

// The id an event or a click carries: the event's data, else the control's attribute.
function idOf(detail, control) {
  if (typeof detail === 'string' && detail) return detail
  if (detail && typeof detail === 'object' && typeof detail.value === 'string') return detail.value
  return control ? control.getAttribute(ID_ATTR) : null
}

function freeSlots(count) {
  const slots = []
  for (let i = count; i < SETTINGS.maxItems; i++) slots.push({ id: '', title: '', image: '' })
  return slots
}

// The rows the page draws: the attributes the owner chose, the best value
// marked, the attributes every item shares left out when asked.
function rowsOf(data) {
  const items = data && Array.isArray(data.items) ? data.items : []
  const attributes = data && Array.isArray(data.attributes) ? data.attributes : []
  const shown = attributes.filter((attribute) => {
    if (!SETTINGS.onlyDifferences || items.length < 2) return true
    const texts = items.map((item) => (item.attributes[attribute.key] ? item.attributes[attribute.key].text : ''))
    return texts.some((value) => value !== texts[0])
  })
  const best = {}
  shown.forEach((attribute) => {
    if (!SETTINGS.highlightBest || !attribute.better) return
    const numbers = items.map((item) => (item.attributes[attribute.key] && typeof item.attributes[attribute.key].number === 'number' ? item.attributes[attribute.key].number : null))
    const texts = items.map((item) => (item.attributes[attribute.key] ? item.attributes[attribute.key].text : ''))
    const known = numbers.filter((value) => value !== null)
    if (!known.length || texts.every((value) => value === texts[0])) return
    const winner = attribute.better === 'low' ? Math.min.apply(null, known) : Math.max.apply(null, known)
    best[attribute.key] = numbers.map((value) => value === winner)
  })
  return items.map((item, index) => {
    const rows = {}
    shown.forEach((attribute) => {
      const cell = item.attributes[attribute.key]
      if (cell) rows[attribute.key] = { label: attribute.label, text: cell.text, best: best[attribute.key] && best[attribute.key][index] ? BEST_LABEL : '' }
    })
    return { id: item.id, kind: data.kind, title: item.title, url: item.url || '', image: item.image || '', attributes: rows }
  })
}

// The rows of the items' custom properties: every name an item shows (in the
// order they first appear, one row per name whatever its case), or the ones
// the owner picked — each item's value side by side, '' where it has none;
// with "only differences", the rows every item agrees on left out.
function customRowsOf(data) {
  const items = data && Array.isArray(data.items) ? data.items : []
  const kind = data && data.kind
  const mode = SETTINGS.propertyRows[kind] || 'all'
  if (mode === 'none' || items.length === 0) return []
  const lists = mode === 'chosen'
    ? [SETTINGS.properties[kind] || []]
    : items.map((item) => (Array.isArray(item.properties) ? item.properties : []).map((property) => property.key))
  const names = []
  lists.forEach((list) => {
    list.forEach((name) => {
      const label = String(name || '').trim()
      if (label && !names.some((known) => known.key === label.toLowerCase())) names.push({ key: label.toLowerCase(), label })
    })
  })
  const rows = []
  for (let i = 0; i < names.length && rows.length < MAX_CUSTOM_ROWS; i++) {
    const name = names[i]
    const cells = items.map((item) => {
      const found = (Array.isArray(item.properties) ? item.properties : []).find((property) => String(property.key || '').toLowerCase() === name.key)
      return { text: found ? String(found.value || '') : '' }
    })
    if (cells.every((cell) => !cell.text)) continue
    if (SETTINGS.onlyDifferences && cells.length > 1 && cells.every((cell) => cell.text === cells[0].text)) continue
    rows.push({ key: name.key, label: name.label, cells })
  }
  return rows
}

function Toast({ message }) {
  return message ? <div className="tq-compare-toast" role="status">{message}</div> : null
}

const ${ITEM_COMPARISON_COMPONENT_NAME} = () => {
  const router = useRouter()
  const [toast, setToast] = useState('')
  const cache = useRef({ key: '', data: null })
  const requested = useRef(0)

  const announce = useCallback((message) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2400)
  }, [])

  // The comparison page shows the picks; the tray never shows there, nor in a checkout.
  const path = router.asPath.split(/[?#]/)[0]
  const onComparePage = !!(SETTINGS.compareRoute && (path === SETTINGS.compareRoute || path.indexOf(SETTINGS.compareRoute + '/') === 0))
  const quietPage = onComparePage || /^\\/(cart|checkout)(\\/|$)/.test(path)

  // Answers the page's and the tray's workflows with the comparison as it is
  // now; \`loading\` while the picked rows are still on their way.
  const answer = useCallback((picks, data, loading) => {
    const rows = rowsOf(data)
    const detail = {
      kind: picks.kind,
      count: picks.ids.length,
      loading: loading ? 'true' : 'false',
      trayVisible: picks.ids.length > 0 && !quietPage,
      trayOpen: trayOpen(),
      items: rows,
      customRows: customRowsOf(data),
      slots: rows.slice(0, SETTINGS.maxItems).map((row) => ({ id: row.id, title: row.title, image: row.image })).concat(freeSlots(Math.min(rows.length, SETTINGS.maxItems))),
    }
    window.dispatchEvent(new CustomEvent(EVENT_PREFIX + ITEMS_EVENT, { detail }))
  }, [quietPage])

  // The picked rows, through the compare route, remembered per set of ids.
  // Every publish is a newer request: an answer still on its way for an
  // older one (cleared or changed meanwhile) is dropped.
  const publish = useCallback(() => {
    const request = ++requested.current
    const picks = readPicks()
    syncToggles(picks)
    if (!picks.kind || picks.ids.length === 0) {
      cache.current = { key: '', data: null }
      answer(picks, null, false)
      return
    }
    const key = picks.kind + ':' + picks.ids.join(',')
    if (cache.current.key === key && cache.current.data) {
      answer(picks, cache.current.data, false)
      return
    }
    const known = cache.current.data && cache.current.data.kind === picks.kind ? cache.current.data : null
    answer(picks, known ? { ...known, items: known.items.filter((item) => picks.ids.indexOf(item.id) >= 0) } : null, true)
    fetch(COMPARE_ROUTE + '?kind=' + encodeURIComponent(picks.kind) + '&ids=' + encodeURIComponent(picks.ids.join(',')))
      .then((response) => response.json())
      .catch(() => null)
      .then((payload) => {
        if (request !== requested.current) return
        if (!payload || !payload.success) {
          answer(picks, known, false)
          return
        }
        // A row that is gone or no longer offered leaves the comparison too.
        const kept = picks.ids.filter((id) => payload.items.some((item) => item.id === id))
        cache.current = { key: picks.kind + ':' + kept.join(','), data: payload }
        if (kept.length !== picks.ids.length) {
          writePicks({ kind: kept.length ? picks.kind : null, ids: kept })
          return
        }
        answer(picks, payload, false)
      })
  }, [answer])

  useEffect(() => {
    const toggle = (kind, id) => {
      if (!kind || !id) return
      const current = readPicks()
      let next
      if (current.kind && current.kind !== kind && current.ids.length) {
        if (!window.confirm('Your comparison holds items of another kind. Start a new comparison with this one?')) return
        next = { kind, ids: [id] }
      } else if (current.ids.indexOf(id) >= 0) {
        next = { kind: current.ids.length > 1 ? kind : null, ids: current.ids.filter((picked) => picked !== id) }
      } else if (current.ids.length >= SETTINGS.maxItems) {
        announce('You can compare up to ' + SETTINGS.maxItems + ' items. Remove one first.')
        return
      } else {
        next = { kind, ids: current.ids.concat(id) }
      }
      if (!writePicks(next)) {
        announce('The comparison cannot be kept in this browser.')
        return
      }
      announce(next.ids.indexOf(id) >= 0 ? 'Added to the comparison' : 'Removed from the comparison')
    }
    const remove = (id) => {
      const current = readPicks()
      if (!id || current.ids.indexOf(id) < 0) return
      const ids = current.ids.filter((picked) => picked !== id)
      writePicks({ kind: ids.length ? current.kind : null, ids })
    }
    const clear = () => writePicks({ kind: null, ids: [] })

    // The controls' workflows send these; a control without its workflow (an
    // older project) is caught by the click fallbacks below.
    const onEvent = (event) => {
      const name = event.type.slice(EVENT_PREFIX.length)
      if (name.indexOf(TOGGLE_EVENT_PREFIX) === 0) toggle(name.slice(TOGGLE_EVENT_PREFIX.length), idOf(event.detail, null))
      else if (name === REMOVE_EVENT) remove(idOf(event.detail, null))
      else if (name === CLEAR_EVENT) clear()
      else if (name === REQUEST_EVENT) publish()
      else if (name === FOLD_EVENT || name === UNFOLD_EVENT) {
        chooseTray(name === FOLD_EVENT ? 'folded' : 'open')
        publish()
      }
    }
    const names = [EVENT_PREFIX + TOGGLE_EVENT_PREFIX + 'products', EVENT_PREFIX + TOGGLE_EVENT_PREFIX + 'bookingItems', EVENT_PREFIX + REMOVE_EVENT, EVENT_PREFIX + CLEAR_EVENT, EVENT_PREFIX + REQUEST_EVENT, EVENT_PREFIX + FOLD_EVENT, EVENT_PREFIX + UNFOLD_EVENT]
    names.forEach((name) => window.addEventListener(name, onEvent))
    // A phone turned, a window narrowed: the tray follows the screen until the visitor chooses.
    const media = window.matchMedia ? window.matchMedia(PHONE_QUERY) : null
    const onMedia = () => {
      if (!trayChoice()) publish()
    }
    if (media && media.addEventListener) media.addEventListener('change', onMedia)
    else if (media && media.addListener) media.addListener(onMedia)
    const onClick = (event) => {
      const target = event.target && event.target.closest ? event.target : null
      if (!target) return
      const toggleControl = target.closest(TOGGLE_SELECTOR)
      if (toggleControl) {
        event.preventDefault()
        toggle(toggleControl.getAttribute(KIND_ATTR), toggleControl.getAttribute(ID_ATTR))
        return
      }
      const removeControl = target.closest(REMOVE_SELECTOR)
      if (removeControl) {
        event.preventDefault()
        remove(removeControl.getAttribute(ID_ATTR))
        return
      }
      if (target.closest(CLEAR_SELECTOR)) {
        event.preventDefault()
        clear()
      }
    }
    // Capture phase: a control whose workflow already handled the click stops
    // the bubble, so this only ever hears the controls without one.
    document.addEventListener('click', onClick)
    window.addEventListener(CHANGE_EVENT, publish)
    window.addEventListener('storage', publish)
    return () => {
      names.forEach((name) => window.removeEventListener(name, onEvent))
      if (media && media.removeEventListener) media.removeEventListener('change', onMedia)
      else if (media && media.removeListener) media.removeListener(onMedia)
      document.removeEventListener('click', onClick)
      window.removeEventListener(CHANGE_EVENT, publish)
      window.removeEventListener('storage', publish)
    }
  }, [announce, publish])

  // After each navigation: the address can name a shared comparison, the new
  // page's listeners want the picks, and cards drawn later get their state once more.
  useEffect(() => {
    const kind = typeof router.query.kind === 'string' ? router.query.kind : ''
    const ids = typeof router.query.ids === 'string' ? router.query.ids.split(',').filter(Boolean) : []
    if (onComparePage && kind && ids.length) {
      writePicks({ kind, ids: ids.slice(0, SETTINGS.maxItems) })
    }
    publish()
    const timer = window.setTimeout(publish, 800)
    return () => window.clearTimeout(timer)
  }, [router.asPath, onComparePage, publish])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      <Toast message={toast} />
    </>
  )
}

export default ${ITEM_COMPARISON_COMPONENT_NAME}
`
}
