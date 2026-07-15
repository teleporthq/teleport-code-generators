import { relative } from 'path'
import { UIDLPropDefinition, UIDLStateDefinition } from '@teleporthq/teleport-types'

/**
 * `path.relative()`-equivalent that is correct regardless of which `path`
 * implementation the runtime substitutes for Node's 'path' module.
 *
 * When this package's code runs inside a browser context (e.g. teleport-gui's
 * packProject() Web Worker), webpack/Next.js swap Node's 'path' for Next's own
 * internally vendored/compiled copy of `path-browserify`
 * (`next/dist/compiled/path-browserify`) — and THAT copy has its `resolve()`'s
 * `process.cwd()` fallback stripped out (replaced with an empty string, likely
 * so it also works in the Edge Runtime), so `resolve()` silently returns a
 * NON-absolute string for relative inputs. `relative()`'s internal index
 * bookkeeping assumes `resolve()` always returns an absolute (leading-'/')
 * path, so it unconditionally treats the first character as that root '/' —
 * dropping one real character from the result once `from`/`to` are 3+
 * segments deep. Confirmed: `relative('a/b/c', 'resources/x')` returns
 * `'../..resources/x'` under Next's compiled polyfill instead of the correct
 * `'../../../resources/x'` — this exact corruption shipped broken import
 * paths (`Module not found`) into real Next.js builds on Vercel, while every
 * local test passed, because local tests always run under real Node's 'path'.
 *
 * Fix: pre-root both arguments with a literal '/'. `resolve()` short-circuits
 * the instant it sees an already-absolute argument, so `process.cwd()` (or
 * its broken stand-in) is never consulted — this produces byte-identical,
 * correct output under both real Node 'path' and Next's compiled polyfill.
 *
 * Any local-dependency relative path computed from code that might run
 * inside teleport-gui's packer Web Worker MUST go through this helper
 * instead of calling `relative()` directly.
 */
export const localRelativePath = (from: string, to: string): string =>
  relative(`/${from}`, `/${to}`)

export const generateLocalDependenciesPrefix = (fromPath: string[], toPath: string[]): string => {
  /*
    Remove common path elements from the beginning of the
    components and pages full path (if any)

    For example, having:
    - fromPath = ['src', 'components']
    - toPath = ['src', 'pages']

    If we want to have an import statement that goes from the pages folder to the
    components folder, we only need to go back one step, so we are removing
    the first element from both the paths ('src') and build the dependencyPrefix accordingly
  */
  const [firstPath, secondPath] = removeCommonStartingPointsFromPaths([fromPath, toPath])

  // We have to go back as many folders as there are defined in the pages path
  let dependencyPrefix = '../'.repeat(firstPath.length)

  // if 'fromPath' is parent for 'toPath', the path starts from './'
  if (firstPath.length === 0) {
    secondPath.unshift('.')
  }

  dependencyPrefix += secondPath
    .map((folder) => {
      return `${folder}/`
    })
    .join('')

  return dependencyPrefix
}

const removeCommonStartingPointsFromPaths = (paths: string[][]): string[][] => {
  const pathsClone: string[][] = JSON.parse(JSON.stringify(paths))

  const shortestPathLength = Math.min(
    ...pathsClone.map((path) => {
      return path.length
    })
  )

  let elementIndex = 0
  let elementsFromIndexAreEqual = true

  while (elementIndex < shortestPathLength && elementsFromIndexAreEqual) {
    const firstPathElementsFromIndex = pathsClone.map((path: string[]) => {
      return path[0]
    })

    if (elementsFromArrayAreEqual(firstPathElementsFromIndex)) {
      // If the first elements from every path are equal, remove it
      pathsClone.forEach((path) => {
        path.shift()
      })
    } else {
      elementsFromIndexAreEqual = false
    }
    elementIndex += 1
  }

  return pathsClone
}

const elementsFromArrayAreEqual = (arrayOfElements: string[]): boolean => {
  return arrayOfElements.every((element: string) => {
    return element === arrayOfElements[0]
  })
}

export const dynamicPathExistsInDefinitions = (
  path: string,
  definitions: Record<string, UIDLPropDefinition> | Record<string, UIDLStateDefinition> = {}
) => {
  if (!path) {
    return false
  }

  // Extract the keys from the path string considering both dot and bracket notation
  const pathKeys = path.split(/\.|\[\s*['"]?(.+?)['"]?\s*\]/).filter(Boolean)

  // Get definition values of prop/state definitions
  let obj = Object.keys(definitions).reduce((acc, key) => {
    if ('defaultValue' in definitions[key]) {
      acc[key] = definitions[key].defaultValue
    }

    return acc
  }, {} as Record<string, unknown>)

  // If the first key does not exist in the object, return true.
  // Which means there might not be a defaultValue that is set for the prop/state
  if (!(pathKeys[0] in obj)) {
    return true
  }

  for (const key of pathKeys) {
    // Check if the key exists in the current object
    // NOTE: using 'key in obj' instead of 'obj[key]' is important to avoid returning 'false' when path exists, but value is empty string/undefined/null
    if (!(key in obj)) {
      return false
    }

    // Move to the next nested object
    obj = obj[key] as Record<string, unknown>
  }

  return true
}

/* tslint:disable no-any */
export const getValueFromPath = (path: string, definition: Record<string, any> = {}): any => {
  const pathKeys = path.split(/\.|\[(['"]?)(.+?)\1\]/).filter(Boolean)

  /* tslint:disable no-any */
  return pathKeys.reduce((acc: any, key: string) => {
    if (acc === undefined || acc === null) {
      return undefined
    }
    return acc[key]
  }, definition)
}
