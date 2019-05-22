import Ajv from 'ajv'
import componentSchema from '../uidl-schemas/component.json'
import projectSchema from '../uidl-schemas/project.json'

import { traverseNodes } from '@teleporthq/teleport-generator-shared/lib/utils/uidl-utils'
import { ComponentUIDL, ProjectUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

interface ValidationResult {
  valid: boolean
  errorMsg: string
}

export default class Validator {
  private componentValidator: Ajv.ValidateFunction
  private projectValidator: Ajv.ValidateFunction

  constructor() {
    const ajv = new Ajv({
      allErrors: true,
      verbose: true,
    })
    this.componentValidator = ajv.compile(componentSchema)
    this.projectValidator = ajv.compile(projectSchema)
  }

  public validateComponentSchema(input: any): ValidationResult {
    const valid = this.componentValidator(input)

    if (!valid && this.componentValidator.errors) {
      const errors = formatErrors(this.componentValidator.errors)
      return { valid: false, errorMsg: errors }
    }

    return { valid: true, errorMsg: '' }
  }

  public validateProjectSchema(input: Record<string, unknown>): ValidationResult {
    const valid = this.projectValidator(input)

    if (!valid && this.projectValidator.errors) {
      return { valid: false, errorMsg: formatErrors(this.projectValidator.errors) }
    }

    return { valid: true, errorMsg: '' }
  }

  public validateComponentContent(input: any): ValidationResult {
    const verifyDefinitions = checkDynamicDefinitions(input)
    const verifyLocalVariables = checkForLocalVariables(input)

    checkForDuplicateDefinitions(input)
    const errors = verifyDefinitions.errors.concat(verifyLocalVariables.errors)

    if (errors.length > 0) {
      return {
        valid: false,
        errorMsg: `\nUIDL Component Content Validation Error. Please check the following: \n${errors}`,
      }
    }

    return { valid: true, errorMsg: '' }
  }

  public validateProjectContent(input: ProjectUIDL): ValidationResult {
    const verifyRoutes = checkRouteDefinition(input)
    let errors = verifyRoutes.errors

    if (verifyRoutes.errors.length === 0) {
      const verifyRootComponent = checkRootComponent(input)

      const verifyComponentNaming = checkComponentNaming(input)
      const verifyComponentExistence = checkComponentExistence(input)

      errors = verifyRoutes.errors.concat(
        verifyComponentExistence.errors,
        verifyComponentNaming.errors,
        verifyRootComponent.errors
      )
    }

    if (errors.length > 0) {
      return {
        valid: false,
        errorMsg: `\nUIDL Project Content Validation Error. Please check the following: ${errors}`,
      }
    }

    return { valid: true, errorMsg: '' }
  }
}

const checkForDuplicateDefinitions = (input: ComponentUIDL) => {
  const props = Object.keys(input.propDefinitions || {})
  const states = Object.keys(input.stateDefinitions || {})

  props
    .filter((x) => states.includes(x))
    .map((duplicate) =>
      console.warn(
        `\n"${duplicate}" is defined both as a prop and as a state. If you are using VUE Code Generators this can cause bad behavior.`
      )
    )
}

const checkForLocalVariables = (input: ComponentUIDL) => {
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
  return { errors }
}

const checkDynamicDefinitions = (input: any) => {
  const definedKeys = Object.keys(input.propDefinitions || {}).concat(
    Object.keys(input.stateDefinitions || {})
  )
  const usedKeys = []
  const errors = []

  traverseNodes(input.node, (node) => {
    if (
      node.type === 'dynamic' &&
      (node.content.referenceType === 'prop' || node.content.referenceType === 'state')
    ) {
      if (!definedKeys.includes(node.content.id)) {
        const errorMsg = `"${
          node.content.id
        }" is used but not defined. Please add it in definitions`
        errors.push(errorMsg)
      }
      usedKeys.push(node.content.id)
    }
  })

  definedKeys
    .filter((x) => !usedKeys.includes(x))
    .map((diff) => console.warn(`"${diff}" is defined but it is not used in the UIDL.`))

  return { errors }
}

const checkRouteDefinition = (input: ProjectUIDL) => {
  const errors = []

  const keys = Object.keys(input.root.stateDefinitions || {})
  if (!keys.includes('route')) {
    const errorMsg = 'Route is not defined in stateDefinitions'
    errors.push(errorMsg)
  }
  return { errors }
}

const checkComponentExistence = (input: ProjectUIDL) => {
  const errors = []
  const dependencies = Object.keys(input.components)

  traverseNodes(input.root.node, (node) => {
    if (node.content.children) {
      node.content.children.map((child) => {
        if (
          child.content.dependency &&
          child.content.dependency.type === 'local' &&
          !dependencies.includes(child.content.elementType)
        ) {
          const errorMsg = `\nThe component "${
            child.content.elementType
          }" is not defined in the UIDL's component section.`
          errors.push(errorMsg)
        }
      })
    }
  })
  return { errors }
}

const checkComponentNaming = (input: ProjectUIDL) => {
  const errors = []
  const namesUsed = Object.keys(input.components)

  namesUsed
    .filter((name) => input.components[name].name !== name)
    .map((diff) => {
      const errorMsg = `\nThe following dependencies have different name than their key: ${diff}`
      errors.push(errorMsg)
    })

  return { errors }
}

const checkRootComponent = (input: ProjectUIDL) => {
  const errors = []
  const routeNaming = []

  input.root.node.content.children.map((child) => {
    if (child.type !== 'conditional') {
      const errorMsg = `\nRoot Node contains elements of type "${
        child.type
      }". It should contain only elements of type "conditional"`
      errors.push(errorMsg)
    }
    routeNaming.push(child.content.value)
  })

  input.root.stateDefinitions.route.values
    .filter((route) => !routeNaming.includes(route.value))
    .map((route) => {
      const errorMsg = `\nRoot Node contains routes that don't have corresponding components. Check the "value" for the following routes: ${
        route.meta.path
      }.`
      errors.push(errorMsg)
    })

  return { errors }
}

const formatErrors = (errors: any) => {
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
