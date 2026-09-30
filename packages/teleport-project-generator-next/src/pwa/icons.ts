import { ProjectPluginStructure, UIDLWebAppIcons } from '@teleporthq/teleport-types'
import { ICON_FILES, PWA_PUBLIC_FOLDER } from './constants'

const PNG_EXTENSION = '.png'

/** The editor sends bare base64; a data URL is accepted too and reduced to its payload. */
const base64Payload = (value: string): string => {
  const comma = value.startsWith('data:') ? value.indexOf(',') : -1
  return comma === -1 ? value : value.slice(comma + 1)
}

/** Writes the rendered icons to `public/pwa/` as binary files. */
export const writeAppIcons = (structure: ProjectPluginStructure, icons: UIDLWebAppIcons): void => {
  const files = (Object.keys(ICON_FILES) as Array<keyof UIDLWebAppIcons>).map((key) => ({
    name: ICON_FILES[key].slice(0, -PNG_EXTENSION.length),
    fileType: 'png',
    content: base64Payload(icons[key]),
    contentEncoding: 'base64' as const,
  }))

  structure.files.set('pwa-icons', { path: ['public', PWA_PUBLIC_FOLDER], files })
}
