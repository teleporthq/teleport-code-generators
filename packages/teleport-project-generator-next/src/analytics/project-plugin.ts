import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { TRACKER_SOURCE } from './tracker-source'
import { TRACKER_COMPONENT_SOURCE } from './tracker-component'
import { injectSiblingIntoApp } from '../app-sibling-injection'

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
    injectSiblingIntoApp(structure, {
      componentName: 'AnalyticsTracker',
      importStatement: `import AnalyticsTracker from '../components/analytics/AnalyticsTracker';\n`,
    })

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
}
