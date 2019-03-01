import { ComponentDependency, WebManifest } from '../../uidl-definitions/types'

import { PackageJSON } from '../types'
import { prefixPlaygroundAssetsURL } from '../../shared/utils/uidl-utils'
import { slugify } from './helpers'

export const extractExternalDependencies = (dependencies: Record<string, ComponentDependency>) => {
  return Object.keys(dependencies)
    .filter((key) => {
      return dependencies[key].type === 'package'
    })
    .reduce((acc: any, key) => {
      const depInfo = dependencies[key]
      if (depInfo.path) {
        acc[depInfo.path] = depInfo.version
      }

      return acc
    }, {})
}

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
  dependencies: Record<string, ComponentDependency>,
  overwrites: {
    projectName: string
  }
): PackageJSON => {
  const { projectName } = overwrites

  const externalDep = extractExternalDependencies(dependencies)

  return {
    ...packageJSONTemplate,
    name: slugify(projectName),
    dependencies: {
      ...packageJSONTemplate.dependencies,
      ...externalDep,
    },
  }
}
