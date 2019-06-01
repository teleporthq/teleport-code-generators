import Ajv from 'ajv'
import componentSchema from '../uidl-schemas/component.json'
import projectSchema from '../uidl-schemas/project.json'

import { ProjectUIDL, ComponentUIDL } from '@teleporthq/teleport-types'
import * as utils from './utils'

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
      const errors = utils.formatErrors(this.componentValidator.errors)
      return { valid: false, errorMsg: errors }
    }

    return { valid: true, errorMsg: '' }
  }

  public validateProjectSchema(input: Record<string, unknown>): ValidationResult {
    const valid = this.projectValidator(input)

    if (!valid && this.projectValidator.errors) {
      return { valid: false, errorMsg: utils.formatErrors(this.projectValidator.errors) }
    }

    return { valid: true, errorMsg: '' }
  }

  public validateComponentContent(input: ComponentUIDL): ValidationResult {
    const errorsInDefinitions = utils.checkDynamicDefinitions(input)
    const errorsWithLocalVariables = utils.checkForLocalVariables(input)

    utils.checkForDuplicateDefinitions(input)
    const errors = [...errorsInDefinitions, ...errorsWithLocalVariables]

    if (errors.length > 0) {
      return {
        valid: false,
        errorMsg: `\nUIDL Component Content Validation Error. Please check the following: \n${errors}`,
      }
    }

    return { valid: true, errorMsg: '' }
  }

  public validateProjectContent(input: ProjectUIDL): ValidationResult {
    const errorsOnRouteNode = utils.checkRouteDefinition(input) || []
    let allErrors = errorsOnRouteNode

    if (errorsOnRouteNode.length === 0) {
      const errorsInRootComponent = utils.checkRootComponent(input)

      const errorsWithComponentNaming = utils.checkComponentNaming(input)
      const errorsWtihComponentExistence = utils.checkComponentExistence(input)

      allErrors = [
        ...errorsOnRouteNode,
        ...errorsWtihComponentExistence,
        ...errorsWithComponentNaming,
        ...errorsInRootComponent,
      ]
    }

    if (allErrors.length > 0) {
      return {
        valid: false,
        errorMsg: `\nUIDL Project Content Validation Error. Please check the following: ${allErrors}`,
      }
    }

    return { valid: true, errorMsg: '' }
  }
}
