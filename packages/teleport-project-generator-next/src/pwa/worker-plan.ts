import { ProjectUIDL, UIDLInstallableWebApp } from '@teleporthq/teleport-types'
import { WebPush } from '@teleporthq/teleport-shared'
import { collectUsedNodeTypes } from '@teleporthq/teleport-plugin-next-workflows'

/**
 * - `app`: the project is an installable app.
 * - `notify`: it is not, but a workflow shows notifications or manages push —
 *   the worker only handles notifications and leaves the network alone.
 * - `retire`: neither, while an earlier publish may have shipped a worker: the
 *   app's, or the notifications worker of a project whose push is set up.
 */
export type ServiceWorkerMode = 'app' | 'notify' | 'retire'

export interface WorkerPlan {
  mode: ServiceWorkerMode | null
  app: UIDLInstallableWebApp | null
  /** Present when the app stores push subscriptions: keys set up AND a push node used. */
  push: { vapidPublicKey: string; subscriptionsPath: string } | null
}

const usedNodeTypes = (uidl: ProjectUIDL): Set<string> =>
  uidl.workflows?.workflows ? collectUsedNodeTypes(uidl.workflows) : new Set<string>()

export const resolveWorkerPlan = (uidl: ProjectUIDL): WorkerPlan => {
  const nodeTypes = usedNodeTypes(uidl)
  const usesAny = (types: ReadonlyArray<string>) => types.some((type) => nodeTypes.has(type))

  const app = uidl.pwa && uidl.pwa.installable ? uidl.pwa : null
  const push =
    uidl.webPush?.vapidPublicKey && usesAny(WebPush.PUSH_NODE_TYPES)
      ? {
          vapidPublicKey: uidl.webPush.vapidPublicKey,
          subscriptionsPath: WebPush.SUBSCRIPTIONS_ROUTE,
        }
      : null

  let mode: ServiceWorkerMode | null = null
  if (app) {
    mode = 'app'
  } else if (usesAny(WebPush.SERVICE_WORKER_NODE_TYPES)) {
    mode = 'notify'
  } else if (uidl.pwa || uidl.webPush) {
    mode = 'retire'
  }

  return { mode, app, push }
}
