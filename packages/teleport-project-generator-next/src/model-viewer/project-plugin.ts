import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { injectImportIntoApp } from '../app-import-injection'

const MODEL_VIEWER_PACKAGE = '@google/model-viewer'

/**
 * Matches @google/model-viewer@4.3.1's peer range. Shipped as an EXPLICIT
 * dependency because generated projects carry `.npmrc legacy-peer-deps=true`
 * (written for the calendar/kanban peer conflicts), which disables npm 7+'s
 * automatic peer-dependency installation — without this line the unbundled
 * model-viewer build fails `next build` with "Can't resolve 'three'".
 */
const THREE_VERSION = '^0.183.0'

const MODEL_VIEWER_CSS_IMPORT = "import './model-viewer.css'"

const MODEL_VIEWER_ORBIT_RESET_IMPORT = "import '../utils/model-viewer-orbit-reset'"

/**
 * Stamped on the wrapper div by GUI builders whose viewers should return to
 * their default view: after the shopper stops orbiting, the camera glides
 * back to the orbit the model loaded with, and the auto-rotation carries on
 * from the correct position instead of whatever angle the drag ended at.
 * Mirrors `MODEL_VIEWER_ORBIT_RESET_ATTR` in the GUI's
 * app/constants/primitives/model-viewer.ts; the behaviour ships as the
 * `utils/model-viewer-orbit-reset` module below.
 */
const MODEL_VIEWER_ORBIT_RESET_ATTR = 'data-tq-model-orbit-reset'

/**
 * Stamped on the wrapper div by GUI builders that SIZE the wrapper themselves
 * (a product card's media box, a 120px list thumbnail): the viewer must fill
 * exactly that box, so the safety-net `min-height` below is switched off for
 * it. Mirrors `MODEL_VIEWER_FILL_ATTR` in the GUI's
 * app/constants/primitives/model-viewer.ts.
 */
const MODEL_VIEWER_FILL_ATTR = 'data-tq-model-fill'

/**
 * React (< 19) writes `className` on CUSTOM ELEMENTS as the dead attribute
 * `classname`, so no class-based styling can reach <model-viewer> in a
 * generated page. The element is therefore emitted style-less inside a styled
 * wrapper div, and this global rule makes it fill that wrapper. The
 * `min-height` keeps a viewer visible even when it ends up in an auto-height
 * parent (e.g. a hand-written UIDL that skipped the wrapper).
 *
 * `--poster-color` overrides the library's opaque white default poster, which
 * would otherwise hide the wrapper's own background until the model loads —
 * the editor canvas applies the same override, so the two stay identical.
 */
const MODEL_VIEWER_CSS = `model-viewer {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 150px;
  --poster-color: transparent;
}
[${MODEL_VIEWER_FILL_ATTR}] > model-viewer {
  min-height: 0;
}
`

/**
 * The "return to the default view" runtime for viewers under a wrapper marked
 * `data-tq-model-orbit-reset`.
 *
 * Why a script at all: `<model-viewer camera-controls auto-rotate>` natively
 * resumes its turntable after an interaction, but from whatever camera orbit
 * the drag ended at — a product model dragged to face away stays facing away.
 * This module captures each marked viewer's orbit at `load` (which includes
 * any builder-set zoom) and, once the shopper has been idle for a moment,
 * writes it back; model-viewer interpolates camera-orbit changes, so the
 * return is the "nice animation", and it lands before the native auto-rotate
 * delay (3s) brings the spin back.
 *
 * Progressive enhancement: viewers without the marker (hand-placed ones) are
 * untouched, and every failure path leaves native behaviour in place. The
 * MutationObserver arms viewers that mount later — SPA navigation and the
 * gallery lightbox render them long after this module ran.
 */
const MODEL_VIEWER_ORBIT_RESET_JS = `/* Return-to-default-view for <model-viewer> product media (TeleportHQ).
   See the model-viewer project plugin in teleport-project-generator-next. */

const ORBIT_RESET_ATTR = '${MODEL_VIEWER_ORBIT_RESET_ATTR}'

// Long enough that a pause between two drags does not yank the model away,
// short enough that the glide home finishes before the native auto-rotate
// delay (3000ms) resumes the spin.
const IDLE_BEFORE_RESET_MS = 1600

function armViewer(viewer) {
  if (viewer.__tqOrbitResetArmed) {
    return
  }
  viewer.__tqOrbitResetArmed = true

  let initialOrbit = null
  let pointerHeld = false
  let resetTimer = null

  const captureInitialOrbit = () => {
    try {
      initialOrbit = viewer.getCameraOrbit().toString()
    } catch (_error) {
      initialOrbit = null
    }
  }
  viewer.addEventListener('load', captureInitialOrbit)
  if (viewer.loaded) {
    // Already loaded before we armed (a late SPA re-mount pass).
    captureInitialOrbit()
  }

  const resetOrbit = () => {
    resetTimer = null
    if (pointerHeld) {
      // A held-still pointer emits no camera-change; wait for the release.
      scheduleReset()
      return
    }
    if (!initialOrbit) {
      return
    }
    try {
      // model-viewer interpolates camera-orbit changes — this IS the glide.
      viewer.cameraOrbit = initialOrbit
    } catch (_error) {
      /* native behaviour stays */
    }
  }

  function scheduleReset() {
    if (resetTimer) {
      clearTimeout(resetTimer)
    }
    resetTimer = setTimeout(resetOrbit, IDLE_BEFORE_RESET_MS)
  }

  viewer.addEventListener('camera-change', (event) => {
    if (event.detail && event.detail.source === 'user-interaction') {
      scheduleReset()
    }
  })
  viewer.addEventListener('pointerdown', () => {
    pointerHeld = true
  })
  const releasePointer = () => {
    pointerHeld = false
  }
  viewer.addEventListener('pointerup', releasePointer)
  viewer.addEventListener('pointercancel', releasePointer)
  viewer.addEventListener('pointerleave', releasePointer)
}

function armAllViewers() {
  document.querySelectorAll('[' + ORBIT_RESET_ATTR + '] > model-viewer').forEach(armViewer)
}

if (typeof window !== 'undefined') {
  armAllViewers()
  // Debounced through a frame: the observer fires for every DOM change and
  // arming is idempotent, so one sweep per frame is plenty.
  let sweepPending = false
  const observer = new MutationObserver(() => {
    if (sweepPending) {
      return
    }
    sweepPending = true
    requestAnimationFrame(() => {
      sweepPending = false
      armAllViewers()
    })
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
}
`

/**
 * Companion to the `model-viewer-node` mapping: whenever the resolver added
 * @google/model-viewer to the project (i.e. a page actually uses the 3D
 * primitive), pin its `three` peer alongside it and ship the global sizing
 * stylesheet. Keyed off the dependency map rather than a UIDL walk so it can
 * never disagree with what package.json actually contains.
 */
export class NextModelViewerProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { dependencies, files } = structure

    if (!dependencies[MODEL_VIEWER_PACKAGE]) {
      return structure
    }

    if (!dependencies.three) {
      dependencies.three = THREE_VERSION
    }

    files.set('model-viewer-css', {
      path: ['pages'],
      files: [
        {
          name: 'model-viewer',
          fileType: FileType.CSS,
          content: MODEL_VIEWER_CSS,
        },
      ],
    })
    injectImportIntoApp(structure, MODEL_VIEWER_CSS_IMPORT)

    files.set('model-viewer-orbit-reset', {
      path: ['utils'],
      files: [
        {
          name: 'model-viewer-orbit-reset',
          fileType: FileType.JS,
          content: MODEL_VIEWER_ORBIT_RESET_JS,
        },
      ],
    })
    injectImportIntoApp(structure, MODEL_VIEWER_ORBIT_RESET_IMPORT)

    return structure
  }
}
