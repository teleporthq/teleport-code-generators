import {
  FileType,
  GeneratedFile,
  ProjectPlugin,
  ProjectPluginStructure,
} from '@teleporthq/teleport-types'
import { TRACKER_SOURCE } from './tracker-source'
import { TRACKER_COMPONENT_SOURCE } from './tracker-component'

const ENV_URL_KEY = 'NEXT_PUBLIC_TELEPORT_ANALYTICS_URL'
const ENV_PUBLIC_KEY = 'NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY'
const TELEPORT_SECRETS_PREFIX = 'teleporthq.secrets.'

// Growth visitor analytics. When `uidl.analytics.enabled` is set (paid plan +
// analytics on at publish time), the published project ships a tiny
// self-contained first-party tracker — no npm dependency — wired to the
// pages-router navigation events. The real env values are substituted at
// deploy time by the platform (replaceSecretsFromEnvFile).
export class NextAnalyticsProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files } = structure

    if (!uidl.analytics?.enabled) {
      return structure
    }

    files.set('teleport-analytics-lib', {
      path: ['lib'],
      files: [
        {
          name: 'teleport-analytics',
          fileType: FileType.JS,
          content: TRACKER_SOURCE,
        },
      ],
    })

    files.set('teleport-analytics-tracker', {
      path: ['components', 'analytics'],
      files: [
        {
          name: 'AnalyticsTracker',
          fileType: FileType.JS,
          content: TRACKER_COMPONENT_SOURCE,
        },
      ],
    })

    this.addEnvVariables(uidl)
    this.injectTrackerIntoApp(structure)

    return structure
  }

  private addEnvVariables(uidl: ProjectPluginStructure['uidl']): void {
    if (!uidl.globals.env) {
      uidl.globals.env = {}
    }

    // Placeholder values resolved against project secrets at deploy time;
    // the GUI mapper usually sets these already — only fill the gaps.
    if (!uidl.globals.env[ENV_URL_KEY]) {
      uidl.globals.env[ENV_URL_KEY] = `${TELEPORT_SECRETS_PREFIX}${ENV_URL_KEY}`
    }
    if (!uidl.globals.env[ENV_PUBLIC_KEY]) {
      uidl.globals.env[ENV_PUBLIC_KEY] = `${TELEPORT_SECRETS_PREFIX}${ENV_PUBLIC_KEY}`
    }
  }

  // Same proven string-surgery as the AI-chat widget injection: import before
  // the first import, then wrap the returned JSX in a fragment with the
  // tracker as a sibling.
  private injectTrackerIntoApp(structure: ProjectPluginStructure): void {
    const { files } = structure

    let appFile: GeneratedFile | null = null
    for (const [key, record] of Array.from(files.entries())) {
      if (key === '_app' || key.includes('_app')) {
        const found = record.files?.find(
          (file: GeneratedFile) =>
            file.name === '_app' && (file.fileType === 'js' || file.fileType === 'tsx')
        )
        if (found) {
          appFile = found
          break
        }
      }
    }

    if (!appFile || typeof appFile.content !== 'string') {
      return
    }
    if (appFile.content.includes('AnalyticsTracker')) {
      return
    }

    let content = appFile.content

    const trackerImport = `import AnalyticsTracker from '../components/analytics/AnalyticsTracker';\n`
    const firstImportIdx = content.indexOf('import ')
    if (firstImportIdx >= 0) {
      content = content.slice(0, firstImportIdx) + trackerImport + content.slice(firstImportIdx)
    } else {
      content = trackerImport + content
    }

    const returnMatch = content.match(/return\s*\(\s*/)
    if (returnMatch && returnMatch.index !== undefined) {
      const afterReturn = returnMatch.index + returnMatch[0].length
      const restContent = content.slice(afterReturn)
      const closingParenIdx = findMatchingClosingParen(restContent)
      if (closingParenIdx >= 0) {
        const innerJSX = restContent.slice(0, closingParenIdx)
        const afterClosing = restContent.slice(closingParenIdx)
        // Both halves of the fragment are required — omitting `</>` produces
        // a syntax error in _app.js.
        content =
          content.slice(0, afterReturn) + `<>${innerJSX}<AnalyticsTracker /></>` + afterClosing
      }
    }

    appFile.content = content
  }
}

function findMatchingClosingParen(str: string): number {
  let depth = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '(') {
      depth++
    }
    if (ch === ')') {
      if (depth === 0) {
        return i
      }
      depth--
    }
  }
  return -1
}
