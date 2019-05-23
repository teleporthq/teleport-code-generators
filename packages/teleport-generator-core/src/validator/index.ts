import Ajv from 'ajv'
import componentSchema from '../uidl-schemas/component.json'
import projectSchema from '../uidl-schemas/project.json'

import { ProjectUIDL, ComponentUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'
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
    const verifyDefinitions = utils.checkDynamicDefinitions(input)
    const verifyLocalVariables = utils.checkForLocalVariables(input)

    utils.checkForDuplicateDefinitions(input)
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
    const verifyRoutes = utils.checkRouteDefinition(input)
    let errors = verifyRoutes.errors

    if (verifyRoutes.errors.length === 0) {
      const verifyRootComponent = utils.checkRootComponent(input)

      const verifyComponentNaming = utils.checkComponentNaming(input)
      const verifyComponentExistence = utils.checkComponentExistence(input)

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
