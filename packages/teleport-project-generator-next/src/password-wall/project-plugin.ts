import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import {
  MIDDLEWARE_FILES_KEY,
  WALL_ENV_KEYS,
  WALL_HELPER_NAME,
  WALL_HELPER_PATH,
  WALL_PAGE_HELPER_NAME,
} from './constants'
import { buildWallHelperSource } from './helper-source'
import { buildStandaloneWallMiddleware, wrapMiddlewareWithWall } from './gate-source'
import { buildPasswordPageModule } from './page-html'
import { buildSignInRouteSource } from './sign-in-route-source'

/**
 * The password wall every site carries: a gate at the front of its middleware,
 * the route that serves the password page and signs in, the page's HTML, and
 * the helper they share. The platform decides at publish whether the wall is up (a
 * workspace without paid hosting always is) by filling the `.env` values the
 * plugin declares empty; a site exported or run locally has them empty, and
 * then nothing here does anything.
 *
 * Runs after the workflows plugin, whose middleware for members-only pages it
 * wraps when there is one; a site without one gets a middleware of its own.
 */
export class NextPasswordWallProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl, files } = structure

    uidl.globals.env = uidl.globals.env || {}
    for (const key of WALL_ENV_KEYS) {
      if (!(key in uidl.globals.env)) {
        uidl.globals.env[key] = ''
      }
    }

    files.set('site-wall-helper', {
      path: WALL_HELPER_PATH,
      files: [{ name: WALL_HELPER_NAME, fileType: FileType.JS, content: buildWallHelperSource() }],
    })
    files.set('site-wall-page', {
      path: WALL_HELPER_PATH,
      files: [
        {
          name: WALL_PAGE_HELPER_NAME,
          fileType: FileType.JS,
          content: buildPasswordPageModule({
            logoUrl: uidl.globals.settings.passwordWall?.logo,
            siteTitle: uidl.globals.settings.title,
          }),
        },
      ],
    })
    files.set('site-wall-sign-in-route', {
      path: ['pages', 'api'],
      files: [{ name: 'site-password', fileType: FileType.JS, content: buildSignInRouteSource() }],
    })

    const existing = files.get(MIDDLEWARE_FILES_KEY)
    const middlewareFile = existing?.files.find((file) => file.name === 'middleware')
    if (existing && middlewareFile) {
      middlewareFile.content = wrapMiddlewareWithWall(middlewareFile.content)
    } else {
      files.set(MIDDLEWARE_FILES_KEY, {
        path: [],
        files: [
          { name: 'middleware', fileType: FileType.JS, content: buildStandaloneWallMiddleware() },
        ],
      })
    }

    return structure
  }
}
