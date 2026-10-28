import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'

const NEXT_CONFIG_KEY = 'next.config'
const MODULE_EXPORTS_OPENING = /module\.exports\s*=\s*\{/
const IMAGES_KEY = /(^|[\s,{])images\s*:/

/**
 * `next/image` settings of every generated site. The generator hands
 * next/image only the project's own files (`teleport-plugin-jsx-next-image`
 * converts an <img> whose src is under /playground_assets), so no remote host
 * is allowed — the optimizer never fetches and decodes an image an attacker
 * chose, which the image-optimizer CVEs of Next 12 / sharp need — and an SVG,
 * which can carry script, is never optimized. Both are Next's defaults; they
 * are written out so a merge or an upgrade cannot widen them unnoticed.
 */
export const NEXT_IMAGE_SETTINGS_SOURCE = `  images: {
    remotePatterns: [],
    dangerouslyAllowSVG: false,
  },`

/**
 * Adds the settings to the project's next.config, creating it when there is
 * none. An `images` key already there is someone else's decision and is left
 * alone.
 */
export const addNextConfigImageSettings = (structure: ProjectPluginStructure): void => {
  const configFile = structure.files
    .get(NEXT_CONFIG_KEY)
    ?.files.find((file) => file.name === NEXT_CONFIG_KEY && file.fileType === FileType.JS)

  if (!configFile) {
    structure.files.set(NEXT_CONFIG_KEY, {
      path: [],
      files: [
        {
          name: NEXT_CONFIG_KEY,
          fileType: FileType.JS,
          content: `module.exports = {\n${NEXT_IMAGE_SETTINGS_SOURCE}\n}\n`,
        },
      ],
    })
    return
  }

  const content = configFile.content
  if (IMAGES_KEY.test(content)) {
    return
  }
  const opening = content.match(MODULE_EXPORTS_OPENING)
  if (!opening || opening.index === undefined) {
    return
  }
  const insertAt = opening.index + opening[0].length
  configFile.content =
    content.slice(0, insertAt) + `\n${NEXT_IMAGE_SETTINGS_SOURCE}` + content.slice(insertAt)
}

export class NextImageSettingsProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    addNextConfigImageSettings(structure)
    return structure
  }
}
