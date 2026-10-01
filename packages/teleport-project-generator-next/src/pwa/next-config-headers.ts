import { ProjectPluginStructure } from '@teleporthq/teleport-types'
import { addNextConfigHeaderRules, NextHeaderRule } from '../next-config-headers'
import { SERVICE_WORKER_PATH } from './constants'

const headerRules = (manifestHrefs: string[]): NextHeaderRule[] => [
  {
    source: SERVICE_WORKER_PATH,
    headers: [
      // The browser must see every new worker the moment it is published.
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      { key: 'Service-Worker-Allowed', value: '/' },
    ],
  },
  ...manifestHrefs.map((href) => ({
    source: href,
    headers: [
      { key: 'Content-Type', value: 'application/manifest+json; charset=utf-8' },
      { key: 'Cache-Control', value: 'no-cache' },
    ],
  })),
]

/**
 * Serves the worker and the manifests with the headers they need, through
 * `next.config.js`, in the same `headers()` as the site's security headers —
 * whichever of the two plugins runs first writes it, the other adds to it.
 */
export const injectServiceWorkerHeaders = (
  structure: ProjectPluginStructure,
  manifestHrefs: string[]
): void => {
  addNextConfigHeaderRules(structure, headerRules(manifestHrefs))
}
