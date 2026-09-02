import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { injectImportIntoApp } from '../app-import-injection'
import { traverseProjectElements } from '../uidl-element-traversal'

/**
 * The "Play sound on" contract: three data-* attributes stamped on ordinary
 * elements (text/button/container) by the GUI inspector. Mirrors
 * `PLAY_SOUND_ATTR` in the GUI's app/constants/primitives/play-sound.ts —
 * keep the two in sync.
 */
const PLAY_SOUND_SRC_ATTR = 'data-tq-sound-src'
const PLAY_SOUND_TRIGGER_ATTR = 'data-tq-sound-trigger'
const PLAY_SOUND_VOLUME_ATTR = 'data-tq-sound-volume'

const PLAY_SOUND_IMPORT = "import '../utils/play-sound'"

/**
 * Delegated runtime for the sound attributes. One capture-phase listener per
 * DOM event on `document` — no per-node wiring, so elements mounted later
 * (SPA navigation, conditional renders) work without a MutationObserver.
 *
 * Design notes baked into the code below:
 * - `mouseover`/`mouseout` emulate mouseenter/mouseleave through the
 *   relatedTarget containment check (the enter/leave pair does not bubble, so
 *   it cannot be delegated directly).
 * - Nested hosts: the search walks OUTWARD from the innermost host until one
 *   declares the trigger that matches the event, so a click-sound button
 *   inside a hover-sound section leaves the section's hover sound intact.
 * - Autoplay policy: browsers reject play() before the visitor's first
 *   interaction (relevant for hover/mouse-leave) — the rejection is swallowed
 *   so it never surfaces as an unhandled promise rejection.
 * - One Audio instance per src, restarted from 0 on every trigger; volume is
 *   re-applied per host so two elements can share a sound at different
 *   volumes.
 */
const PLAY_SOUND_RUNTIME_JS = `/* "Play sound on" interaction runtime (TeleportHQ).
   See the play-sound project plugin in teleport-project-generator-next. */

const SRC_ATTR = '${PLAY_SOUND_SRC_ATTR}'
const TRIGGER_ATTR = '${PLAY_SOUND_TRIGGER_ATTR}'
const VOLUME_ATTR = '${PLAY_SOUND_VOLUME_ATTR}'
const DEFAULT_TRIGGER = 'click'

const audioBySrc = {}

function volumeOf(host) {
  const raw = parseInt(host.getAttribute(VOLUME_ATTR) || '', 10)
  if (!isFinite(raw)) {
    return 1
  }
  return Math.min(100, Math.max(0, raw)) / 100
}

function playSoundFor(host) {
  const src = host.getAttribute(SRC_ATTR)
  if (!src) {
    return
  }
  let audio = audioBySrc[src]
  if (!audio) {
    audio = new Audio(src)
    audio.preload = 'auto'
    audioBySrc[src] = audio
  }
  audio.volume = volumeOf(host)
  try {
    audio.currentTime = 0
  } catch (_error) {
    /* not seekable yet — play() starts from 0 anyway */
  }
  const result = audio.play()
  if (result && typeof result.catch === 'function') {
    // Autoplay policy rejects before the first user gesture — stay silent.
    result.catch(function () {})
  }
}

function asElement(target) {
  if (target && target.nodeType === 1) {
    return target
  }
  return target && target.parentElement ? target.parentElement : null
}

// Innermost-out: the first ancestor host whose declared trigger matches.
function findMatchingHost(start, wantedTrigger) {
  let el = start
  while (el) {
    const host = el.closest('[' + SRC_ATTR + ']')
    if (!host) {
      return null
    }
    if ((host.getAttribute(TRIGGER_ATTR) || DEFAULT_TRIGGER) === wantedTrigger) {
      return host
    }
    el = host.parentElement
  }
  return null
}

function handleSimpleEvent(wantedTrigger) {
  return function (event) {
    const target = asElement(event.target)
    if (!target) {
      return
    }
    const host = findMatchingHost(target, wantedTrigger)
    if (host) {
      playSoundFor(host)
    }
  }
}

// mouseover/mouseout fire on every descendant crossing; only a crossing of
// the HOST's own boundary counts (mouseenter/mouseleave semantics).
function handleBoundaryEvent(wantedTrigger) {
  return function (event) {
    const target = asElement(event.target)
    if (!target) {
      return
    }
    const host = findMatchingHost(target, wantedTrigger)
    if (!host) {
      return
    }
    const related = event.relatedTarget
    if (related && host.contains(related)) {
      return
    }
    playSoundFor(host)
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('click', handleSimpleEvent('click'), true)
  document.addEventListener('dblclick', handleSimpleEvent('double-click'), true)
  document.addEventListener('mousedown', handleSimpleEvent('mouse-down'), true)
  document.addEventListener('mouseover', handleBoundaryEvent('hover'), true)
  document.addEventListener('mouseout', handleBoundaryEvent('mouse-leave'), true)
}
`

const projectUsesPlaySound = (uidl: ProjectPluginStructure['uidl']): boolean => {
  let found = false
  traverseProjectElements(uidl, (element) => {
    if (!found && element.attrs?.[PLAY_SOUND_SRC_ATTR]) {
      found = true
    }
  })
  return found
}

/**
 * Ships the "Play sound on" runtime whenever any element in the project
 * carries the sound-src attribute. Gated by a UIDL walk (the feature has no
 * npm dependency to key off, unlike the model-viewer plugin) so soundless
 * projects get zero extra bytes.
 */
export class NextPlaySoundProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { files, uidl } = structure

    if (!projectUsesPlaySound(uidl)) {
      return structure
    }

    files.set('play-sound-runtime', {
      path: ['utils'],
      files: [
        {
          name: 'play-sound',
          fileType: FileType.JS,
          content: PLAY_SOUND_RUNTIME_JS,
        },
      ],
    })
    injectImportIntoApp(structure, PLAY_SOUND_IMPORT)

    return structure
  }
}
