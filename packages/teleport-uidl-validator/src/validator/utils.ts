import Ajv from 'ajv'
import { UIDLUtils } from '@teleporthq/teleport-shared'

import { ProjectUIDL, UIDLElement, ComponentUIDL } from '@teleporthq/teleport-types'

// Prop definitions and state definitions should have different keys
export const checkForDuplicateDefinitions = (input: ComponentUIDL) => {
  const props = Object.keys(input.propDefinitions || {})
  const states = Object.keys(input.stateDefinitions || {})

  props
    .filter((x) => states.includes(x))
    .forEach((duplicate) =>
      console.warn(
        `\n"${duplicate}" is defined both as a prop and as a state. If you are using VUE Code Generators this can cause bad behavior.`
      )
    )
}

// In "repeat" node:
// If index is used, "useIndex" must be declared in "meta"
// If custom local variable is used, it's name must be specified inside "meta" as "iteratorName"
export const checkForLocalVariables = (input: ComponentUIDL) => {
  const errors: string[] = []

  UIDLUtils.traverseRepeats(input.node, (repeatContent) => {
    UIDLUtils.traverseNodes(repeatContent.node, (childNode) => {
      if (childNode.type === 'dynamic' && childNode.content.referenceType === 'local') {
        if (childNode.content.id === 'index') {
          if (!repeatContent.meta.useIndex) {
            const errorMsg = `\nIndex variable is used but the "useIndex" meta information is false.`
            errors.push(errorMsg)
          }

          // we are dealing with local index here
          return
        }

        if (!validLocalVariableUsage(childNode.content.id, repeatContent.meta.iteratorName)) {
          const errorMsg = `\n"${childNode.content.id}" is used in the "repeat" structure but the iterator name has this value: "${repeatContent.meta.iteratorName}"`
          errors.push(errorMsg)
        }
      }
    })
  })
  return errors
}

const validLocalVariableUsage = (dynamicId: string, repeatIteratorName: string) => {
  const iteratorName = repeatIteratorName || 'item'

  if (!dynamicId.includes('.')) {
    return dynamicId === iteratorName
  }

  const dynamicIdRoot = dynamicId.split('.')[0]
  return dynamicIdRoot === iteratorName
}

// All referenced props and states should be previously defined in the
// "propDefinitions" and "stateDefinitions" sections
// If props or states are defined and not used, a warning witll be displayed
export const checkDynamicDefinitions = (input: any) => {
  const propKeys = Object.keys(input.propDefinitions || {})
  const stateKeys = Object.keys(input.stateDefinitions || {})

  const usedPropKeys: string[] = []
  const usedStateKeys: string[] = []
  const errors: string[] = []

  UIDLUtils.traverseNodes(input.node, (node) => {
    if (node.type === 'dynamic' && node.content.referenceType === 'prop') {
      if (!dynamicPathExistsInDefinitions(node.content.id, propKeys)) {
        const errorMsg = `"${node.content.id}" is used but not defined. Please add it in propDefinitions`
        errors.push(errorMsg)
      }

      // for member expression we check the root
      // if value has no `.` it will be checked as it is
      const dynamicIdRoot = node.content.id.split('.')[0]
      usedPropKeys.push(dynamicIdRoot)
    }

    if (node.type === 'dynamic' && node.content.referenceType === 'state') {
      if (!dynamicPathExistsInDefinitions(node.content.id, stateKeys)) {
        const errorMsg = `\n"${node.content.id}" is used but not defined. Please add it in stateDefinitions`
        errors.push(errorMsg)
      }

      // for member expression we check the root
      // if value has no `.` it will be checked as it is
      const dynamicIdRoot = node.content.id.split('.')[0]
      usedStateKeys.push(dynamicIdRoot)
    }
  })

  propKeys
    .filter((x) => !usedPropKeys.includes(x))
    .forEach((diff) =>
      console.warn(`"${diff}" is defined in propDefinitions but it is not used in the UIDL.`)
    )

  stateKeys
    .filter((x) => !usedStateKeys.includes(x))
    .forEach((diff) =>
      console.warn(`"${diff}" is defined in stateDefinitions but it is not used in the UIDL.`)
    )

  return errors
}

const dynamicPathExistsInDefinitions = (path: string, defKeys: string[]) => {
  if (!path.includes('.')) {
    // prop/state is a scalar value, not a dot notation
    return defKeys.includes(path)
  }

  // TODO: Expand validation logic to check if the path exists on the prop/state definition
  // ex: if prop reference is `user.name`, we should check that prop type is object and has a valid field name
  const rootIdentifier = path.split('.')[0]
  return defKeys.includes(rootIdentifier)
}

// A projectUIDL must contain "route" key
export const checkRouteDefinition = (input: ProjectUIDL) => {
  const errors = []

  const keys = Object.keys(input.root.stateDefinitions || {})
  if (!keys.includes('route')) {
    const errorMsg = 'Route is not defined in stateDefinitions'
    errors.push(errorMsg)
  }
  return errors
}

// All referenced components inside of the projectUIDL should be defined
// in the component section
export const checkComponentExistence = (input: ProjectUIDL) => {
  const errors: string[] = []
  const components = Object.keys(input.components)

  UIDLUtils.traverseElements(input.root.node, (element) => {
    if (
      element.dependency &&
      element.dependency.type === 'local' &&
      !components.includes(element.elementType)
    ) {
      const errorMsg = `\nThe component "${element.elementType}" is not defined in the UIDL's component section.`
      errors.push(errorMsg)
    }
  })
  return errors
}

// All components should have the same key as the value of their name key
// Example:
//  "components": {
//     "OneComponent": {
//       "name": "OneComponent",
//    ..
//      }
//    }
export const checkComponentNaming = (input: ProjectUIDL) => {
  const errors = []
  const namesUsed = Object.keys(input.components)

  const diffs = namesUsed.filter((name) => input.components[name].name !== name)

  if (diffs.length > 0) {
    const errorMsg = `\nThe following components have different name than their key: ${diffs}`
    errors.push(errorMsg)
  }

  return errors
}

// The "root" node should contain only elements of type "conditional"
export const checkRootComponent = (input: ProjectUIDL) => {
  const errors = []
  const routeNaming: string[] = []
  const rootNode = input.root.node.content as UIDLElement
  rootNode.children.forEach((child) => {
    if (child.type !== 'conditional') {
      const errorMsg = `\nRoot Node contains elements of type "${child.type}". It should contain only elements of type "conditional"`
      errors.push(errorMsg)
    } else {
      routeNaming.push(child.content.value.toString())
    }
  })

  const routeValues = input.root.stateDefinitions.route.values
  if (!routeValues || routeValues.length <= 0) {
    errors.push(
      '\nThe `route` state definition from the root node does not contain the possible route values'
    )
  } else {
    input.root.stateDefinitions.route.values
      .filter((route) => !routeNaming.includes(route.value.toString()))
      .forEach((route) => {
        const errorMsg = `\nRoot Node contains a route that don't have a specified state: ${route.value}.`
        errors.push(errorMsg)
      })
  }

  return errors
}

// The errors should be displayed in a human-readeable way
export const formatErrors = (errors: Ajv.ErrorObject[]) => {
  const listOfErrors: string[] = []
  errors.forEach((error) => {
    const message =
      error.keyword === 'type'
        ? `\n - Path ${error.dataPath}: ${error.message}. Received ${typeof error.data}`
        : `\n - Path ${error.dataPath}: ${error.message}. ${JSON.stringify(error.params)}`
    listOfErrors.push(message)
  })

  return `UIDL Format Validation Error. Please check the following: ${listOfErrors}`
}
