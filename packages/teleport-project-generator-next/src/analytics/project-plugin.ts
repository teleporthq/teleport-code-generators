import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { TRACKER_SOURCE } from './tracker-source'
import { TRACKER_COMPONENT_SOURCE } from './tracker-component'
import { injectSiblingIntoApp } from '../app-sibling-injection'

const ENV_URL_KEY = 'NEXT_PUBLIC_TELEPORT_ANALYTICS_URL'
const ENV_PUBLIC_KEY = 'NEXT_PUBLIC_TELEPORT_ANALYTICS_KEY'
const TELEPORT_SECRETS_PREFIX = 'teleporthq.secrets.'

/** Host both the gtag script and the Tag Manager container are loaded from. */
const GOOGLE_TAG_HOST = 'googletagmanager.com'
/** The array both of them push into, and the one the mirror writes to. */
const DATA_LAYER_GLOBAL = 'dataLayer'

/**
 * True when the project already loads something that reads `window.dataLayer` —
 * a Google Analytics tag or a Tag Manager container, injected as script assets
 * by the GUI's project mapper from the merchant's own ids.
 */
function hasDataLayerConsumer(uidl: ProjectPluginStructure['uidl']): boolean {
  const assets = uidl.globals?.assets ?? []
  return assets.some((asset) => {
    if (asset.type !== 'script') {
      return false
    }
    const path = 'path' in asset && typeof asset.path === 'string' ? asset.path : ''
    const content = 'content' in asset && typeof asset.content === 'string' ? asset.content : ''
    return path.indexOf(GOOGLE_TAG_HOST) !== -1 || content.indexOf(DATA_LAYER_GLOBAL) !== -1
  })
}

// Growth visitor analytics. When `uidl.analytics.enabled` is set (paid plan +
// analytics on at publish time), the published project ships a tiny
// self-contained first-party tracker — no npm dependency — wired to the
// pages-router navigation events. The real env values are substituted at
// deploy time by the platform (replaceSecretsFromEnvFile).
//
// ⛔ It also ships when the merchant configured GA4 or Tag Manager and left OUR
// analytics off. The commerce funnel is fired from serialized workflow handlers
// that can only reach a global, and `window.tpTrackCommerce` is published by
// this component — so without it a store with a GTM container gets NO
// add_to_cart, begin_checkout or purchase events at all, which is precisely the
// "run GA4/Ads out of the box" the funnel exists for. Emitting it is inert for
// our own beacons: `isTrackingPossible()` refuses to send without the analytics
// URL and key, and those env placeholders are deliberately NOT written on this
// branch — a project whose analytics is off must not have them resolved at
// deploy and quietly start reporting.
export class NextAnalyticsProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files } = structure

    const teleportAnalyticsEnabled = !!uidl.analytics?.enabled
    if (!teleportAnalyticsEnabled && !hasDataLayerConsumer(uidl)) {
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

    if (teleportAnalyticsEnabled) {
      this.addEnvVariables(uidl)
    }
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
