import { PageTransition } from '@teleporthq/teleport-shared'
import {
  FileType,
  GeneratedFile,
  ProjectPlugin,
  ProjectPluginStructure,
} from '@teleporthq/teleport-types'
import { appendGlobalCss } from './global-css'
import {
  BACK_ATTR,
  ORIGIN_X,
  ORIGIN_Y,
  viewTransitionPlan,
} from './page-transition/view-transition-css'

/**
 * The site's page transition in the static HTML export (see
 * page-transition/view-transition-css.ts for how it is played).
 *
 * The stylesheet does the work. A page gets a script only for what a
 * stylesheet cannot know:
 *
 *   which way the visitor came   the back button plays the preset the other way
 *   where the visitor pressed    a circle reveal grows from that point
 *   "this page opted out"        a page that skips transitions appears at once;
 *                                leaving it still plays, the editor's rule
 *
 * All three hang on `pagereveal`, which the browser fires on the arriving page
 * before its first frame, so the script is inline in the head. A project with
 * a plain fade ships no script at all.
 */

const ORIGIN_KEY = 'tq-page-transition-origin'

const arrivalScript = (plan: { needsDirection: boolean; needsOrigin: boolean }): string => {
  const lines = ['(function (root) {']
  if (plan.needsOrigin) {
    lines.push(
      `  addEventListener('pointerdown', function (event) {`,
      `    try { sessionStorage.setItem('${ORIGIN_KEY}', event.clientX + 'px ' + event.clientY + 'px') } catch (e) {}`,
      `  }, true)`
    )
  }
  lines.push(
    `  addEventListener('pagereveal', function (event) {`,
    `    if (!event.viewTransition) { return }`,
    `    var activation = window.navigation && window.navigation.activation`,
    `    var current = window.navigation && window.navigation.currentEntry`,
    `    var back = !!(activation && activation.navigationType === 'traverse' && activation.from && current && current.index < activation.from.index)`
  )
  if (plan.needsDirection) {
    lines.push(`    if (back) { root.setAttribute('${BACK_ATTR}', 'back') }`)
  }
  if (plan.needsOrigin) {
    lines.push(
      `    var origin = null`,
      `    try { origin = sessionStorage.getItem('${ORIGIN_KEY}') } catch (e) {}`,
      `    if (origin && !back) {`,
      `      root.style.setProperty('${ORIGIN_X}', origin.split(' ')[0])`,
      `      root.style.setProperty('${ORIGIN_Y}', origin.split(' ')[1])`,
      `    }`
    )
  }
  lines.push(
    `    event.viewTransition.finished.then(function () {`,
    `      root.removeAttribute('${BACK_ATTR}')`,
    `      root.style.removeProperty('${ORIGIN_X}')`,
    `      root.style.removeProperty('${ORIGIN_Y}')`,
    `    })`,
    `  })`,
    `})(document.documentElement)`
  )
  return lines.join('\n')
}

export const SKIP_ARRIVAL_SCRIPT =
  `addEventListener('pagereveal', function (event) {\n` +
  `  if (event.viewTransition) { event.viewTransition.skipTransition() }\n` +
  `})`

interface RouteValue {
  value: string
  pageOptions?: { navLink?: string; fileName?: string }
}

/** The generated documents of the pages that opted out, as "folder/name" with the home page as "index". */
const skippedDocuments = (structure: ProjectPluginStructure, skipRoutes: string[]): Set<string> => {
  const patterns = skipRoutes.map(PageTransition.pageTransitionSkipPattern)
  const route = structure.uidl.root.stateDefinitions?.route
  const documents = new Set<string>()
  ;((route?.values || []) as RouteValue[]).forEach((page) => {
    const navLink = page.pageOptions?.navLink
    const fileName = page.pageOptions?.fileName
    if (!navLink || !fileName || !patterns.some((pattern) => pattern.test(navLink))) {
      return
    }
    const folder = navLink.split('/').slice(1, -1)
    const name = page.value === route?.defaultValue ? 'index' : fileName
    documents.add([...folder, name].join('/'))
  })
  return documents
}

const injectIntoHead = (file: GeneratedFile, script: string): GeneratedFile =>
  file.content.includes('</head>')
    ? {
        ...file,
        content: file.content.replace('</head>', `<script>\n${script}\n</script>\n</head>`),
      }
    : file

export class ProjectPluginPageTransition implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const config = PageTransition.projectPageTransition(structure.uidl)
    const plan = config ? viewTransitionPlan(config) : null
    if (!config || !plan) {
      return structure
    }
    appendGlobalCss(structure, plan.css)

    const skipRoutes = Array.isArray(config.skipRoutes)
      ? config.skipRoutes.filter((route) => typeof route === 'string' && route.length > 0)
      : []
    const skipped = skippedDocuments(structure, skipRoutes)
    const pagesRoot = (structure.strategy.pages?.path || []).filter(Boolean)
    const everyPage = plan.needsDirection || plan.needsOrigin ? arrivalScript(plan) : null

    structure.files.forEach((entry, key) => {
      const folder = entry.path.filter(Boolean).slice(pagesRoot.length)
      structure.files.set(key, {
        ...entry,
        files: entry.files.map((file: GeneratedFile) => {
          if (file.fileType !== FileType.HTML) {
            return file
          }
          if (skipped.has([...folder, file.name].join('/'))) {
            return injectIntoHead(file, SKIP_ARRIVAL_SCRIPT)
          }
          return everyPage ? injectIntoHead(file, everyPage) : file
        }),
      })
    })
    return structure
  }
}

export const pluginPageTransition = new ProjectPluginPageTransition()
