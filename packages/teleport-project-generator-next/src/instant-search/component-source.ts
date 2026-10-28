import { toJsLiteral } from '../pwa/source-literals'
import { SEARCH_ROUTE } from './search-route'
import { InstantSearchConfig, SearchSectionKey } from './settings'

export const INSTANT_SEARCH_COMPONENT_FILE = 'teleport-instant-search'
export const INSTANT_SEARCH_COMPONENT_NAME = 'TeleportInstantSearch'
/** The events between the Search component's workflows and this runtime (the editor's `search-control-markers.ts` names the same). */
const EVENT_PREFIX = 'workflow:custom:'
const OPEN_EVENT = 'tq-search-open'
const CLOSE_EVENT = 'tq-search-close'
const QUERY_EVENT = 'tq-search-query'
const CLEAR_EVENT = 'tq-search-clear'
const STATE_EVENT = 'tq-search-state'
const RESULTS_EVENT_PREFIX = 'tq-search-results:'
/** The modal's field (the editor's `SEARCH_FIELD_MARKER`): focused once the modal opens. */
const FIELD_SELECTOR = '[data-tq-search-field]'
/** A link inside the modal (the editor's `SEARCH_MODAL_MARKER`): following one closes it, even to the page already shown. */
const MODAL_LINK_SELECTOR = '[data-tq-search-modal] a[href]'

/**
 * `components/teleport-instant-search.js`, rendered once from `_app`: the
 * runtime behind the project's own Search component (a modal the search
 * control opens through a workflow). Nothing is drawn here. The component's
 * field sends `tq-search-query` with the words as the visitor types. This
 * waits `debounceMs` (300 by default) after the last change, then asks the
 * search route for EVERY section at once — each section with its own loading
 * state. Fewer than `minCharacters` never waits and never asks. It answers
 * `tq-search-results:<section>` per section
 * (`{ query, loading: 'idle' | 'true' | 'false' | 'error', items }`) and `tq-search-state`
 * (`{ query, status: 'idle' | 'short' | 'searching' | 'done' }`), which the
 * component's workflows take into its states. The field's clear button sends
 * `tq-search-clear`: the field empties, a search
 * still waiting is dropped, the cursor stays and the search starts over.
 * The keyboard shortcuts open the modal (`tq-search-open`); Escape and
 * a navigation close it (`tq-search-close`).
 * Whoever opens it — the control's workflow, a shortcut — the field is focused
 * once the modal is drawn.
 *
 * Authored as source text; the settings the client needs are baked in as one
 * literal.
 */
export const buildInstantSearchComponentSource = (
  config: InstantSearchConfig,
  /** The sections the route can answer for this project. */
  sections: SearchSectionKey[]
): string => {
  const client = {
    hotkeys: config.settings.hotkeys,
    minCharacters: config.settings.minCharacters,
    debounceMs: config.settings.debounceMs,
    limit: config.settings.resultsPerSection,
    sections,
  }
  return `import { useEffect, useRef } from 'react'
import { useRouter } from 'next/router'

const SETTINGS = ${toJsLiteral(client)}
const SEARCH_ROUTE = ${toJsLiteral(SEARCH_ROUTE)}
const EVENT_PREFIX = ${toJsLiteral(EVENT_PREFIX)}
const OPEN_EVENT = ${toJsLiteral(OPEN_EVENT)}
const CLOSE_EVENT = ${toJsLiteral(CLOSE_EVENT)}
const QUERY_EVENT = ${toJsLiteral(QUERY_EVENT)}
const CLEAR_EVENT = ${toJsLiteral(CLEAR_EVENT)}
const STATE_EVENT = ${toJsLiteral(STATE_EVENT)}
const RESULTS_EVENT_PREFIX = ${toJsLiteral(RESULTS_EVENT_PREFIX)}
const FIELD_SELECTOR = ${toJsLiteral(FIELD_SELECTOR)}
const MODAL_LINK_SELECTOR = ${toJsLiteral(MODAL_LINK_SELECTOR)}

// The component's workflows take these into its states.
function tell(name, detail) {
  window.dispatchEvent(new CustomEvent(EVENT_PREFIX + name, { detail }))
}

// The words an event carries: the field's value, or a plain string.
function wordsOf(detail) {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object' && typeof detail.value === 'string') return detail.value
  return ''
}

function isTypingTarget(target) {
  if (!target || !target.tagName) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}

const ${INSTANT_SEARCH_COMPONENT_NAME} = () => {
  const router = useRouter()
  // Every search is a newer request: an answer still on its way for older words is dropped.
  const request = useRef(0)
  // The search waiting for the visitor to pause.
  const wait = useRef(null)

  useEffect(() => {
    const search = (words) => {
      const trimmed = String(words || '').trim()
      const id = ++request.current
      if (trimmed.length < SETTINGS.minCharacters) {
        // Nothing asked of the sections: 'idle', so no list says "nothing found".
        tell(STATE_EVENT, { query: trimmed, status: trimmed ? 'short' : 'idle' })
        SETTINGS.sections.forEach((section) => {
          tell(RESULTS_EVENT_PREFIX + section, { query: trimmed, loading: 'idle', items: [] })
        })
        return
      }
      tell(STATE_EVENT, { query: trimmed, status: 'searching' })
      let pending = SETTINGS.sections.length
      SETTINGS.sections.forEach((section) => {
        tell(RESULTS_EVENT_PREFIX + section, { query: trimmed, loading: 'true', items: [] })
        fetch(
          SEARCH_ROUTE +
            '?q=' +
            encodeURIComponent(trimmed) +
            '&section=' +
            encodeURIComponent(section) +
            '&limit=' +
            SETTINGS.limit
        )
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null)
          .then((payload) => {
            if (id !== request.current) return
            // A section that could not be read says so, rather than "nothing found".
            const items = payload && Array.isArray(payload.items) ? payload.items : null
            tell(RESULTS_EVENT_PREFIX + section, {
              query: trimmed,
              loading: items ? 'false' : 'error',
              items: items || [],
            })
            if (--pending === 0) tell(STATE_EVENT, { query: trimmed, status: 'done' })
          })
      })
      if (pending === 0) tell(STATE_EVENT, { query: trimmed, status: 'done' })
    }
    const cancelWait = () => {
      if (wait.current) clearTimeout(wait.current)
      wait.current = null
    }
    // Enough characters: search once the visitor pauses. Fewer: say so at once.
    const searchWhenPaused = (words) => {
      cancelWait()
      const trimmed = String(words || '').trim()
      if (!SETTINGS.debounceMs || trimmed.length < SETTINGS.minCharacters) {
        search(trimmed)
        return
      }
      wait.current = setTimeout(() => {
        wait.current = null
        search(trimmed)
      }, SETTINGS.debounceMs)
    }
    // A late event after the clear button: an emptied field is what stands.
    const onQuery = (event) => {
      const field = document.querySelector(FIELD_SELECTOR)
      searchWhenPaused(field && typeof field.value === 'string' && !field.value.trim() ? '' : wordsOf(event.detail))
    }
    // The clear button: the words go, a search still waiting is dropped, the cursor stays.
    const onClear = () => {
      cancelWait()
      const field = document.querySelector(FIELD_SELECTOR)
      if (field) {
        field.value = ''
        if (typeof field.focus === 'function') field.focus()
      }
      search('')
    }
    // The modal is drawn by the component's own workflow a moment after the
    // event: the field is focused then. What an earlier search left is cleared
    // first, so the modal opens empty every time.
    const onOpen = () => {
      cancelWait()
      search('')
      let tries = 0
      const focus = () => {
        const field = document.querySelector(FIELD_SELECTOR)
        if (field && typeof field.focus === 'function') field.focus()
        else if (++tries < 10) setTimeout(focus, 50)
      }
      setTimeout(focus, 30)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        tell(CLOSE_EVENT)
        return
      }
      if (!SETTINGS.hotkeys) return
      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault()
        tell(OPEN_EVENT)
      } else if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault()
        tell(OPEN_EVENT)
      }
    }
    // A result followed closes the modal — a link to the page already shown changes no address.
    const onClick = (event) => {
      const link = event.target && event.target.closest ? event.target.closest(MODAL_LINK_SELECTOR) : null
      if (link) tell(CLOSE_EVENT)
    }
    window.addEventListener(EVENT_PREFIX + QUERY_EVENT, onQuery)
    window.addEventListener(EVENT_PREFIX + CLEAR_EVENT, onClear)
    window.addEventListener(EVENT_PREFIX + OPEN_EVENT, onOpen)
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onClick)
    return () => {
      cancelWait()
      window.removeEventListener(EVENT_PREFIX + QUERY_EVENT, onQuery)
      window.removeEventListener(EVENT_PREFIX + CLEAR_EVENT, onClear)
      window.removeEventListener(EVENT_PREFIX + OPEN_EVENT, onOpen)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onClick)
    }
  }, [])

  // A navigation closes the modal: the result the visitor followed is the page now.
  useEffect(() => {
    tell(CLOSE_EVENT)
  }, [router.asPath])

  return null
}

export default ${INSTANT_SEARCH_COMPONENT_NAME}
`
}
