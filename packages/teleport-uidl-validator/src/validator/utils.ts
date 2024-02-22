import { UIDLUtils } from '@teleporthq/teleport-shared'

import {
  ProjectUIDL,
  UIDLElement,
  ComponentUIDL,
  UIDLNode,
  UIDLStyleSetDefinition,
  UIDLStaticValue,
  UIDLExternalDependency,
  UIDLElementNodeProjectReferencedStyle,
  UIDLStyleValue,
  UIDLElementNodeInlineReferencedStyle,
  UIDLReferencedStyles,
  UIDLStyleSetTokenReference,
  ComponentValidationError,
} from '@teleporthq/teleport-types'

// Prop definitions and state definitions should have different keys
export const checkForDuplicateDefinitions = (input: ComponentUIDL) => {
  const props = Object.keys(input.propDefinitions || {})
  const states = Object.keys(input.stateDefinitions || {})
  const imports = Object.keys(input.importDefinitions || {})

  props
    .filter((x) => states.includes(x) || imports.includes(x))
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

/* All referenced props, states and importRefs should be previously defined in the
 "propDefinitions" and "stateDefinitions" and "importDefinitions" sections
 If props or states are defined and not used, a warning witll be displayed */
export const checkDynamicDefinitions = (input: Record<string, unknown>) => {
  const propKeys = Object.keys(input.propDefinitions || {})
  const stateKeys = Object.keys(input.stateDefinitions || {})
  let importKeys = Object.keys(input.importDefinitions || {})
  const componentStyleSetKyes = Object.keys(input.styleSetDefinitions || {})

  const importDefinitions: { [key: string]: UIDLExternalDependency } = (input?.importDefinitions ??
    {}) as unknown as { [key: string]: UIDLExternalDependency }

  if (Object.keys(importKeys).length > 0) {
    importKeys = importKeys.reduce((acc, importRef) => {
      if (importDefinitions[importRef]?.meta?.importJustPath) {
        return acc
      }

      acc.push(importRef)
      return acc
    }, [])
  }

  const usedPropKeys: string[] = []
  const usedStateKeys: string[] = []
  const usedImportKeys: string[] = []
  const errors: string[] = []

  UIDLUtils.traverseNodes(input.node as UIDLNode, (node, parent) => {
    if (node.type === 'element') {
      const { content } = node
      const compStyleReference = Object.values(content?.attrs || {}).find(
        (attr) => attr.type === 'comp-style'
      )

      if (
        compStyleReference &&
        content.elementType !== 'component' &&
        content?.dependency?.type === 'local'
      ) {
        const errorMsg = `${JSON.stringify(
          compStyleReference,
          null,
          2
        )} can only be assigned on a local component instances. Tried to assign on ${content}`

        errors.push(errorMsg)
      }
    }

    if (node.type === 'cms-item' || node.type === 'cms-list') {
      Object.values(node.content?.resource?.params || {}).forEach((param) => {
        if (
          param.type === 'dynamic' &&
          (param.content.referenceType === 'state' || param.content.referenceType === 'prop')
        ) {
          param.content.referenceType === 'prop'
            ? usedPropKeys.push(param.content.id)
            : usedStateKeys.push(param.content.id)
        }
      })
    }

    if (node.type === 'element') {
      Object.keys(node.content?.events || {}).forEach((eventKey) => {
        node.content.events[eventKey].forEach((event) => {
          if (event.type === 'stateChange' && !stateKeys.includes(event.modifies)) {
            const errorMsg = `"${event.modifies}" is used in events, but not defined. Please add it in stateDefinitions of ${input.name}`
            errors.push(errorMsg)
            return
          }

          if (event.type === 'propCall' && !propKeys.includes(event.calls)) {
            errors.push(
              `"${event.calls}" is used in events, but missing from propDefinitons. Please add it in propDefinitions ${input.name} `
            )
            return
          }
        })
      })

      const dynamicVariants: string[] = []
      Object.values(node.content?.referencedStyles || {}).forEach((styleRef) => {
        if (
          styleRef.content.mapType === 'component-referenced' &&
          styleRef.content.content.type === 'dynamic'
        ) {
          if (styleRef.content.content.content.referenceType === 'prop') {
            const referencedProp = styleRef.content.content.content.id
            if (
              !dynamicPathExistsInDefinitions(
                referencedProp,
                input.propDefinitions as ComponentUIDL['propDefinitions'],
                'prop'
              )
            ) {
              const errorMsg = `"${referencedProp}" is used but not defined. Please add it in propDefinitions ${input.name}`
              errors.push(errorMsg)
              return
            }
            dynamicVariants.push(referencedProp)
            usedPropKeys.push(referencedProp)
          }

          if (styleRef.content.content.content.referenceType === 'comp') {
            const compStyleRefId = styleRef.content.content.content.id

            if (!componentStyleSetKyes.includes(compStyleRefId)) {
              errors.push(
                `${compStyleRefId} is used, but not defined in Component Style Sheet in ${input.name}. Please add it in StyleSetDefinitions of the component`
              )
            }
          }
        }
      })

      if (dynamicVariants.length > 1) {
        errors.push(`Node ${
          node.content?.name || node.content?.key
        } is using multiple dynamic variants using propDefinitions.
        We can have only one dynamic variant at once`)
      }
    }

    if (node.type === 'dynamic' && node.content.referenceType === 'prop') {
      if (
        !dynamicPathExistsInDefinitions(
          node.content.id,
          input.propDefinitions as ComponentUIDL['propDefinitions'],
          'prop'
        )
      ) {
        const errorMsg = `\n "${node.content.id}" is used but not defined in ${
          input.name
        } component. Please add it in propDefinitions.
Used on Node ${JSON.stringify(node)}.\nParent node is ${JSON.stringify(parent, null, 2)}`
        errors.push(errorMsg)
      }

      // for member expression we check the root
      // if value has no `.` it will be checked as it is
      const dynamicIdRoot = node.content.id.split('.')[0]
      usedPropKeys.push(dynamicIdRoot)
    }

    if (node.type === 'dynamic' && node.content.referenceType === 'state') {
      if (
        !dynamicPathExistsInDefinitions(
          node.content.id,
          input.stateDefinitions as ComponentUIDL['stateDefinitions'],
          'state'
        )
      ) {
        console.warn(
          `\n"${node.content.id}" is used but not defined. Please add it in stateDefinitions`
        )
      }

      // for member expression we check the root
      // if value has no `.` it will be checked as it is
      const dynamicIdRoot = node.content.id.split('.')[0]
      usedStateKeys.push(dynamicIdRoot)
    }

    if (node.type === 'import') {
      if (
        !dynamicPathExistsInDefinitions(
          node.content.id,
          input.importDefinitions as ComponentUIDL['importDefinitions'],
          'import'
        )
      ) {
        const errorMsg = `\n"${node.content.id}" is used but not defined. Please add it in importDefinitions`
        errors.push(errorMsg)
      }

      // for member expression we check the root
      // if value has no `.` it will be checked as it is
      const dynamicIdRoot = node.content.id.split('.')[0]
      usedImportKeys.push(dynamicIdRoot)
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

  importKeys
    .filter((x) => !usedImportKeys.includes(x))
    .forEach((diff) =>
      console.warn(`"${diff}" is defined in importDefinitions but it is not used in the UIDL.`)
    )

  return errors
}

const dynamicPathExistsInDefinitions = (
  path: string,
  definitions: Record<string, unknown> = {},
  type: 'prop' | 'state' | 'import'
) => {
  if (!path) {
    return false
  }

  // Extract the keys from the path string considering both dot and bracket notation
  const pathKeys = path.split(/\.|\[\s*['"]?(.+?)['"]?\s*\]/).filter(Boolean)

  // Get definition values of prop/state/import definitions
  let obj = Object.keys(definitions).reduce((acc, key) => {
    acc[key] =
      type === 'import'
        ? definitions[key]
        : (definitions[key] as Record<string, unknown>).defaultValue

    return acc
  }, {} as Record<string, unknown>)

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
// in the components section and all the project-referenced styles and tokens
export const checkComponentExistenceAndReferences = (input: ProjectUIDL) => {
  const errors: string[] = []
  const components = Object.keys(input.components || {})
  const styleSetDefinitions = Object.keys(input.root?.styleSetDefinitions || {})
  const tokens: string[] = Object.keys(input.root?.designLanguage?.tokens || {})
  const nodesToParse = [
    input.root.node,
    ...Object.values(input.components || {}).map((component) => component.node),
  ]
  let usedReferencedStyles: string[] = []

  if (input.root?.styleSetDefinitions) {
    Object.values(input.root.styleSetDefinitions || {}).forEach((style) => {
      const { content, conditions = [] } = style
      errors.push(...checkForTokensInstyles(content, tokens))
      conditions.forEach((condition) => {
        if (condition?.content) {
          errors.push(...checkForTokensInstyles(condition.content, tokens))
        }
      })
    })
  }

  nodesToParse.forEach((node) => {
    UIDLUtils.traverseElements(node, (element) => {
      /* Checking for project-referenced styles */
      if (element?.referencedStyles) {
        const { errorsInRferences, usedStyleRefrences } = checkForReferencedStylesUsed(
          element.referencedStyles,
          styleSetDefinitions,
          tokens
        )
        errors.push(...errorsInRferences)
        usedReferencedStyles = [...usedReferencedStyles, ...usedStyleRefrences]
      }

      /* Checking for token references used in styles */
      if (element?.style) {
        errors.push(...checkForTokensInstyles(element.style, tokens))
      }

      if (
        element.dependency &&
        element.dependency.type === 'local' &&
        !components.includes(element.semanticType)
      ) {
        const errorMsg = `\nThe component "${element.semanticType}" is not defined in the UIDL's component section.`
        errors.push(errorMsg)
      }
    })
  })

  styleSetDefinitions.forEach((key) => {
    if (!usedReferencedStyles.includes(key)) {
      console.warn(`${key} styleSet is defined but not used in the project.`)
    }
  })

  return errors
}

const checkForReferencedStylesUsed = (
  referencedStyles: UIDLReferencedStyles,
  styleSetDefinitions: string[],
  tokens: string[]
) => {
  const errorsInRferences: string[] = []
  const usedStyleRefrences: string[] = []
  Object.values(referencedStyles || {}).forEach((styleRef) => {
    const { mapType } = styleRef.content

    if (mapType === 'inlined') {
      errorsInRferences.push(
        ...checkForTokensInstyles(
          (styleRef as UIDLElementNodeInlineReferencedStyle).content.styles,
          tokens
        )
      )
    }

    if (mapType === 'project-referenced') {
      const { referenceId } = (styleRef as UIDLElementNodeProjectReferencedStyle).content
      usedStyleRefrences.push(referenceId)
      if (!styleSetDefinitions.includes(referenceId)) {
        errorsInRferences.push(
          `\n ${referenceId} is missing from the styleSetDefinitions, please check the reference id.`
        )
      }
    }
  })
  return {
    errorsInRferences,
    usedStyleRefrences,
  }
}

const checkForTokensInstyles = (styles: Record<string, UIDLStyleValue>, tokens: string[]) => {
  const errors: string[] = []
  Object.values(styles || {}).forEach((style: UIDLStyleValue) => {
    if (
      style.type === 'dynamic' &&
      style.content.referenceType === 'token' &&
      !tokens.includes(style.content.id)
    ) {
      errors.push(`\nToken ${style.content.id} is missing from the project UIDL.`)
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
  const errors: string[] = []
  const namesUsed = Object.keys(input.components || {})

  const diffs = namesUsed.filter((name) => input.components[name].name !== name)

  if (diffs.length > 0) {
    const errorMsg = `\nThe following components have different name than their key: ${diffs}`
    errors.push(errorMsg)
  }

  return errors
}

export const checkProjectStyleSet = (input: ProjectUIDL) => {
  const errors: string[] = []
  const styleSet = input.root.styleSetDefinitions
  if (styleSet) {
    Object.values(styleSet).forEach((styleSetObj: UIDLStyleSetDefinition) => {
      const { content, conditions = [] } = styleSetObj

      Object.values(conditions).forEach((style) => {
        errors.push(...checStylekContentForErrors(style.content))
      })

      errors.push(...checStylekContentForErrors(content))
    })
  }
  return errors
}

export const checStylekContentForErrors = (
  content: Record<string, UIDLStaticValue | UIDLStyleSetTokenReference>
) => {
  const errors: string[] = []
  Object.values(content).forEach((styleContent) => {
    if (styleContent.type === 'dynamic' && styleContent.content.referenceType !== 'token') {
      errors.push(`Dynamic nodes in styleSetDefinitions supports only tokens`)
    }

    if (
      styleContent.type === 'static' &&
      typeof styleContent.content !== 'string' &&
      typeof styleContent.content !== 'number'
    ) {
      errors.push(
        `Project Style sheet / styleSetDefinitions only support styles with static
        content and dynamic tokens, received ${styleContent}`
      )
    }
  })
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
export const formatErrors = (errors: Array<{ kind: string; at: string; message: string }>) => {
  const listOfErrors: string[] = []
  errors.forEach((error) => {
    const message = `\n - Path ${error.at}: ${error.message}. \n is a ${error.kind} \n`
    listOfErrors.push(message)
  })

  return `UIDL Format Validation Error. Please check the following: ${listOfErrors}`
}

export const validateNulls = (uidl: Record<string, unknown>) => {
  return JSON.parse(JSON.stringify(uidl), (key, value) => {
    if (value === undefined || value == null) {
      throw new ComponentValidationError(`Validation error, Received ${value} at ${key}`)
    }
    return value
  })
}
