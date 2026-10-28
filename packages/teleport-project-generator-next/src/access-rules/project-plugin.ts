import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import {
  ageGateActive,
  geoRulesActive,
  resolveAccessRulesRuntime,
  resolveAccessRulesSettings,
} from './settings'
import { buildGateHeadSnippet } from './gate-runtime-source'
import {
  buildGeoMiddlewareSegment,
  buildStandaloneGeoMiddleware,
  wrapMiddlewareWithGeo,
} from './geo-middleware'
import { AUTH_MIDDLEWARE_FILE_KEY, GEO_MIDDLEWARE_FILE_KEY } from './constants'

/**
 * The Age gate & geo block plugin on the published site. The gate is the
 * editor's Age Gate component, drawn on every page like a popup: a head
 * snippet (`runBefore`, since `_document` reads `customCode.head` during
 * generation) shows or hides it before the first paint and drives its
 * workflows; a project without the component has no gate. The country rule
 * goes in the project's middleware — the authentication one when it exists,
 * wrapped, else one of its own — and serves blocked visitors the project's
 * Unavailable page. A project without the plugin comes out exactly as
 * before. Runs after the workflow project plugin, which writes the
 * authentication middleware.
 */
export class NextAccessRulesProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl } = structure
    const settings = resolveAccessRulesSettings(uidl)
    if (!settings) {
      return structure
    }
    const runtime = resolveAccessRulesRuntime(uidl)
    if (runtime.gate !== 'component' || !ageGateActive(settings, runtime)) {
      return structure
    }
    const customCode = uidl.globals.customCode ?? {}
    uidl.globals.customCode = {
      ...customCode,
      head: `${buildGateHeadSnippet(settings, runtime)}${customCode.head ?? ''}`,
    }
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const settings = resolveAccessRulesSettings(structure.uidl)
    if (!settings || !geoRulesActive(settings)) {
      return structure
    }
    const runtime = resolveAccessRulesRuntime(structure.uidl)
    const segment = buildGeoMiddlewareSegment(settings, runtime.unavailableRoute)
    const authMiddleware = structure.files.get(AUTH_MIDDLEWARE_FILE_KEY)
    const middlewareFile = authMiddleware?.files?.find((file) => file.name === 'middleware')
    if (middlewareFile && typeof middlewareFile.content === 'string') {
      const wrapped = wrapMiddlewareWithGeo(middlewareFile.content, segment)
      if (wrapped) {
        middlewareFile.content = wrapped
      }
      return structure
    }
    structure.files.set(GEO_MIDDLEWARE_FILE_KEY, {
      path: [],
      files: [
        {
          name: 'middleware',
          fileType: FileType.JS,
          content: buildStandaloneGeoMiddleware(segment),
        },
      ],
    })
    return structure
  }
}
