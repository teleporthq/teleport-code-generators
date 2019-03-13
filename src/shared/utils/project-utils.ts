import { WebManifest } from '../../uidl-definitions/types'

import { PackageJSON } from '../types'
import { prefixPlaygroundAssetsURL } from '../../shared/utils/uidl-utils'
import { slugify } from './string-utils'

// Creates a manifest json with the UIDL having priority over the default values
export const createManifestJSON = (
  manifest: WebManifest,
  projectName: string,
  assetsPrefix?: string
) => {
  const defaultManifest: WebManifest = {
    short_name: projectName,
    name: projectName,
    display: 'standalone',
    start_url: '/',
  }

  const icons = manifest.icons.map((icon) => {
    const src = prefixPlaygroundAssetsURL(assetsPrefix, icon.src)
    return { ...icon, src }
  })

  return {
    ...defaultManifest,
    ...manifest,
    ...{ icons },
  }
}

export const createPackageJSON = (
  packageJSONTemplate: PackageJSON,
  overwrites: {
    dependencies: Record<string, string>
    projectName: string
  }
): PackageJSON => {
  const { projectName, dependencies } = overwrites

  return {
    ...packageJSONTemplate,
    name: slugify(projectName),
    dependencies: {
      ...packageJSONTemplate.dependencies,
      ...dependencies,
    },
  }
}
