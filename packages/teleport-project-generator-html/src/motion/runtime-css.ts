import {
  MOTION_MARKER_ATTR,
  MOTION_READY_ATTR,
  PAGE_FLAG_ATTR,
  SCENE_LENGTH_ATTR,
  SCENE_PIN_ATTR,
  SCENE_STAGE_ATTR,
  SCENE_TRACK_ATTR,
  SCROLL_VIDEO_ATTR,
} from './contract'

/**
 * The stylesheet half of the static HTML export's motion.
 *
 * In the Next export a scene's track and stage are laid out by inline styles
 * the widget writes, and a small <style> block it renders. A static page has no
 * widget, so the same layout is CSS here. Two rules shape every line of it:
 *
 *   - It only applies once the page has said it will be animated (the flag a
 *     one-line head script puts on <html>). A visitor without JavaScript, or a
 *     page whose runtime never arrives, reads the scene as ordinary content in
 *     normal flow instead of a stack of overlapping chapters.
 *   - The flag is matched inside :where(), which adds no specificity, so each
 *     rule weighs exactly what the Next export's rule weighs and an author's
 *     own styles win or lose the same way in both exports. What the widget
 *     writes inline is `!important` here, the stylesheet's equal of inline.
 */
const FLAG = `:where(html[${PAGE_FLAG_ATTR}])`
const STAGE = `[${SCENE_STAGE_ATTR}]`

/** Mirrors HIDDEN_CSS and COUNT_CSS of the shared lane engine (pinned by a test). */
export const SCENE_HIDDEN_CSS =
  '[data-scene-hidden], [data-scene-hidden] * { pointer-events: none !important; }'
export const SCENE_COUNT_CSS =
  '[data-scroll-count]::before { counter-reset: tq-count var(--tq-count, 0); content: counter(tq-count); }'

/** The backdrop band and the chapters grid: the rules the Next widget renders in its own <style>. */
export const SCENE_BACKDROP_SELECTOR = `${STAGE} > [${SCROLL_VIDEO_ATTR}], ${STAGE} > [data-scene-backdrop], ${STAGE} > img, ${STAGE} > video, ${STAGE} > picture`
export const SCENE_BACKDROP_DECLARATIONS = 'position: absolute; inset: 0; z-index: -1;'
export const SCENE_BACKDROP_MEDIA_SELECTOR = `${STAGE} > img, ${STAGE} > video, ${STAGE} > picture > img`
export const SCENE_BACKDROP_MEDIA_DECLARATIONS = 'width: 100%; height: 100%; object-fit: cover;'
export const SCENE_CHAPTERS_SELECTOR = `${STAGE}[data-scene-layout="chapters"] > :not(style)`
/** The stacking in one cell is the chapters layout itself, so it holds. */
export const SCENE_CHAPTERS_DECLARATIONS = 'grid-area: 1 / 1;'
/**
 * Full width is only a default, under `:where()` (no weight): a width from the
 * chapter's classes or its own styles wins. Forced, it overrode a width the
 * author set in the editor, with nothing there saying why.
 */
export const SCENE_CHAPTERS_DEFAULT_DECLARATIONS = 'width: 100%;'

const prefixed = (selectorList: string): string =>
  selectorList
    .split(',')
    .map((selector) => `${FLAG} ${selector.trim()}`)
    .join(',\n')

export const sceneCss = (sceneLengths: string[]): string =>
  [
    `${FLAG} {\n  overscroll-behavior-y: none;\n}`,
    `${FLAG} [${SCENE_TRACK_ATTR}][${SCENE_PIN_ATTR}="true"] {\n  position: relative !important;\n}`,
    ...sceneLengths.map(
      (length) =>
        `${FLAG} [${SCENE_TRACK_ATTR}][${SCENE_PIN_ATTR}="true"][${SCENE_LENGTH_ATTR}="${length}"] {\n  min-height: ${length} !important;\n}`
    ),
    `${FLAG} ${STAGE} {\n  position: sticky !important;\n  top: 0 !important;\n  min-height: 100vh !important;\n  overflow: hidden !important;\n  isolation: isolate !important;\n  perspective: 900px !important;\n}`,
    `${FLAG} ${STAGE}[data-scene-layout="chapters"] {\n  display: grid !important;\n  place-items: center !important;\n}`,
    `${prefixed(SCENE_CHAPTERS_SELECTOR)} {\n  ${SCENE_CHAPTERS_DECLARATIONS}\n}`,
    `:where(${prefixed(SCENE_CHAPTERS_SELECTOR)}) {\n  ${SCENE_CHAPTERS_DEFAULT_DECLARATIONS}\n}`,
    `${prefixed(SCENE_BACKDROP_SELECTOR)} {\n  ${SCENE_BACKDROP_DECLARATIONS}\n}`,
    `${prefixed(SCENE_BACKDROP_MEDIA_SELECTOR)} {\n  ${SCENE_BACKDROP_MEDIA_DECLARATIONS}\n}`,
    SCENE_COUNT_CSS,
    SCENE_HIDDEN_CSS,
  ].join('\n') + '\n'

/**
 * An entrance starts from its hidden state. Until the runtime has put the
 * element there, the element is kept out of sight, so it never flashes in its
 * final state first. Hover, tap and scroll-linked motion rest visible, so they
 * are never hidden; neither is anything for a visitor who asked for less motion.
 */
const MOTION_WAITING = `${FLAG} [${MOTION_MARKER_ATTR}]:not([data-motion-trigger="hover"]):not([data-motion-trigger="tap"]):not([data-motion-trigger="scroll"]):not([${MOTION_READY_ATTR}])`

export const motionCss = (): string =>
  [
    `:where([${MOTION_MARKER_ATTR}]) {\n  isolation: isolate;\n}`,
    `${MOTION_WAITING} {\n  visibility: hidden;\n}`,
    `@media (prefers-reduced-motion: reduce) {\n  ${MOTION_WAITING} {\n    visibility: visible;\n  }\n}`,
  ].join('\n') + '\n'

export const scrollVideoCss = (): string =>
  [
    `[${SCROLL_VIDEO_ATTR}] {\n  overflow: hidden !important;\n  contain: layout !important;\n}`,
    `[${SCROLL_VIDEO_ATTR}] > video {\n  position: absolute;\n  inset: 0;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n  pointer-events: none;\n}`,
  ].join('\n') + '\n'
