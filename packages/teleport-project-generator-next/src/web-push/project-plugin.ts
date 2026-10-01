import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { WebPush } from '@teleporthq/teleport-shared'
import { getDatabaseDriverDependencies } from '@teleporthq/teleport-plugin-next-workflows'
import { resolveWorkerPlan } from '../pwa/worker-plan'
import {
  buildWebPushServerModule,
  WEB_PUSH_MODULE_NAME,
  WEB_PUSH_MODULE_PATH,
} from './server-module-source'
import { buildSendRouteSource, buildSubscriptionsRouteSource } from './routes-source'

const WEB_PUSH_VERSION = '^3.6.7'

/** `/api/push/subscriptions` → `pages/api/push` + `subscriptions`. */
const routeFile = (route: string): { path: string[]; name: string } => {
  const segments = route.split('/').filter(Boolean)
  return { path: ['pages', ...segments.slice(0, -1)], name: segments[segments.length - 1] }
}

/**
 * The server half of Web Push: the subscription store, the public route a
 * browser saves its subscription through, and the internal route the
 * "Send Push Notification" node sends through. Emitted only for a project
 * whose push keys are set up AND that uses a push node.
 *
 * The public key is written into the environment as-is; the private key is
 * declared empty, which the platform fills at deploy from the project secret
 * of the same name (an export leaves it for the owner to fill).
 */
export class NextWebPushProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files, dependencies } = structure
    const { push } = resolveWorkerPlan(uidl)
    if (!push) {
      return structure
    }

    files.set('web-push-server', {
      path: WEB_PUSH_MODULE_PATH,
      files: [
        { name: WEB_PUSH_MODULE_NAME, fileType: FileType.JS, content: buildWebPushServerModule() },
      ],
    })

    const subscriptionsRoute = routeFile(WebPush.SUBSCRIPTIONS_ROUTE)
    const sendRoute = routeFile(WebPush.SEND_ROUTE)
    files.set('web-push-subscriptions-route', {
      path: subscriptionsRoute.path,
      files: [
        {
          name: subscriptionsRoute.name,
          fileType: FileType.JS,
          content: buildSubscriptionsRouteSource(),
        },
      ],
    })
    files.set('web-push-send-route', {
      path: sendRoute.path,
      files: [{ name: sendRoute.name, fileType: FileType.JS, content: buildSendRouteSource() }],
    })

    const requiredDependencies = {
      ...getDatabaseDriverDependencies('teleport'),
      'web-push': WEB_PUSH_VERSION,
    }
    Object.entries(requiredDependencies).forEach(([name, version]) => {
      if (!dependencies[name]) {
        dependencies[name] = version
      }
    })

    uidl.globals.env = uidl.globals.env || {}
    uidl.globals.env[WebPush.PUBLIC_KEY_ENV] = push.vapidPublicKey
    if (!(WebPush.PRIVATE_KEY_ENV in uidl.globals.env)) {
      uidl.globals.env[WebPush.PRIVATE_KEY_ENV] = ''
    }

    return structure
  }
}
