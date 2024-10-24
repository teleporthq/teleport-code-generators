import { UIDLPropDefinition, UIDLStateDefinition } from '@teleporthq/teleport-types'

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
