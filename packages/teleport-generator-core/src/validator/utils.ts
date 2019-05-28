import {
  traverseNodes,
  traverseElements,
} from '@teleporthq/teleport-generator-shared/lib/utils/uidl-utils'

import {
  ProjectUIDL,
  UIDLElement,
  ComponentUIDL,
} from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

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
  const errors = []

  traverseNodes(input.node, (node) => {
    if (node.type === 'repeat') {
      traverseNodes(node, (childNode) => {
        if (childNode.type === 'dynamic' && childNode.content.referenceType === 'local') {
          if (
            childNode.content.id &&
            node.content.meta.iteratorName &&
            childNode.content.id !== node.content.meta.iteratorName
          ) {
            const errorMsg = `\n"${
              childNode.content.id
            }" is used in the "repeat" structure but the iterator name has this value: "${
              node.content.meta.iteratorName
            }"`
            errors.push(errorMsg)
          }
          if (childNode.content.id && !node.content.meta.useIndex) {
            const errorMsg = `\nIndex variable is used but the "useIndex" meta information is false.`
            errors.push(errorMsg)
          }
        }
      })
    }
  })
  return errors
}

// All referenced props and states should be previously defined in the
// "propDefinitions" and "stateDefinitions" sections
// If props or states are defined and not used, a warning witll be displayed
export const checkDynamicDefinitions = (input: any) => {
  const propKeys = Object.keys(input.propDefinitions || {})
  const stateKeys = Object.keys(input.stateDefinitions || {})

  const usedPropKeys = []
  const usedstateKeys = []
  const errors = []

  traverseNodes(input.node, (node) => {
    if (node.type === 'dynamic' && node.content.referenceType === 'prop') {
      if (!propKeys.includes(node.content.id)) {
        const errorMsg = `"${
          node.content.id
        }" is used but not defined. Please add it in propDefinitions`
        errors.push(errorMsg)
      }
      usedPropKeys.push(node.content.id)
    }

    if (node.type === 'dynamic' && node.content.referenceType === 'state') {
      if (!stateKeys.includes(node.content.id)) {
        const errorMsg = `\n"${
          node.content.id
        }" is used but not defined. Please add it in stateDefinitions`
        errors.push(errorMsg)
      }
      usedstateKeys.push(node.content.id)
    }
  })

  propKeys
    .filter((x) => !usedPropKeys.includes(x))
    .forEach((diff) =>
      console.warn(`"${diff}" is defined in propDefinitions but it is not used in the UIDL.`)
    )

  stateKeys
    .filter((x) => !usedstateKeys.includes(x))
    .forEach((diff) =>
      console.warn(`"${diff}" is defined in stateDefinitions but it is not used in the UIDL.`)
    )

  return errors
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
  const errors = []
  const components = Object.keys(input.components)

  traverseElements(input.root.node, (element) => {
    if (
      element.dependency &&
      element.dependency.type === 'local' &&
      !components.includes(element.elementType)
    ) {
      const errorMsg = `\nThe component "${
        element.elementType
      }" is not defined in the UIDL's component section.`
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
  const routeNaming = []
  const rootNode = input.root.node.content as UIDLElement
  rootNode.children.forEach((child) => {
    if (child.type !== 'conditional') {
      const errorMsg = `\nRoot Node contains elements of type "${
        child.type
      }". It should contain only elements of type "conditional"`
      errors.push(errorMsg)
    } else {
      routeNaming.push(child.content.value)
    }
  })

  input.root.stateDefinitions.route.values
    .filter((route) => !routeNaming.includes(route.value))
    .forEach((route) => {
      const errorMsg = `\nRoot Node contains routes that don't have corresponding components. Check the "value" for the following routes: ${
        route.meta.path
      }.`
      errors.push(errorMsg)
    })

  return errors
}

// The errors should be displayed in a human-readeable way
export const formatErrors = (errors: any) => {
  const listOfErrors = []
  errors.forEach((error) => {
    const message =
      error.keyword === 'type'
        ? `\n - Path ${error.dataPath}: ${error.message}. Received ${typeof error.data}`
        : `\n - Path ${error.dataPath}: ${error.message}. ${JSON.stringify(error.params)}`
    listOfErrors.push(message)
  })

  return `\nUIDL Format Validation Error. Please check the following: ${listOfErrors}`
}
