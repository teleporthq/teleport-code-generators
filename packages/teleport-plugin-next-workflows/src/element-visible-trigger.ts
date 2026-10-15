/**
 * The "On Visible" trigger as it runs in a generated app.
 *
 * Its settings come from the editor's inspector: `threshold` is the PERCENT of
 * the element that must be on screen (0–100, the unit the inspector has always
 * stored) and `once` says whether the workflow runs only the first time.
 * Projects saved before 2026-09-18 carry the second setting as `triggerOnce`,
 * the name the inspector used to write, so it is read as well.
 *
 * Before that date the generator handed the percent straight to
 * IntersectionObserver, which accepts 0–1 and throws a RangeError for anything
 * above 1: any threshold typed in the inspector killed the trigger. It also
 * read only `once`, which the inspector never wrote, so "run once" never held.
 */
export interface ElementVisibleSettings {
  /** The share of the element that must be on screen, as the browser counts it (0–1). */
  threshold: number
  once: boolean
}

export const elementVisibleSettings = (config: Record<string, unknown>): ElementVisibleSettings => {
  const percent = Number(config.threshold)
  const once = config.once ?? config.triggerOnce
  return {
    threshold: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) / 100 : 0,
    once: once !== false,
  }
}

const OBSERVER_STEPS = `[${Array.from({ length: 21 }, (_, step) => step / 20).join(', ')}]`

/**
 * The statements that create the observer `observerVar` and run `onVisible`
 * each time the element BECOMES visible enough (never again while it stays
 * so), or only the first time when the trigger runs once.
 *
 * An element taller than the screen can never be fully in view, so what it
 * needs is capped at what it can reach, the rule the motion widget's in-view
 * trigger follows; with only the requested value as the observer's threshold a
 * tall section asked to be 60% visible would never run its workflow.
 */
export const elementVisibleObserverCode = (
  observerVar: string,
  config: Record<string, unknown>,
  onVisible: string
): string => {
  const { threshold, once } = elementVisibleSettings(config)
  const inView = `${observerVar}_inView`
  return (
    `let ${inView} = false;\n` +
    `const ${observerVar} = new IntersectionObserver(function(entries) {\n` +
    `  entries.forEach(function(entry) {\n` +
    `    const reach = Math.min(1, (window.innerHeight || 1) / Math.max(1, entry.boundingClientRect.height));\n` +
    `    const visible = entry.isIntersecting && entry.intersectionRatio >= Math.min(${threshold}, reach * 0.9);\n` +
    `    if (visible && !${inView}) {\n` +
    `      ${onVisible}\n` +
    (once ? `      ${observerVar}.disconnect();\n` : '') +
    `    }\n` +
    `    ${inView} = visible;\n` +
    `  });\n` +
    `}, { threshold: ${threshold > 0 ? OBSERVER_STEPS : '0'} });\n`
  )
}
