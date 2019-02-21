import { ComponentDependency, WebManifest } from '../../uidl-definitions/types'

// Only package dependencies are needed for the package.json file
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
export const createManifestJSON = (manifest: WebManifest, projectName?: string) => {
  const defaultManifest: WebManifest = {
    short_name: projectName,
    name: projectName,
    display: 'standalone',
    start_url: '/',
  }

  return {
    ...defaultManifest,
    ...manifest,
  }
}
