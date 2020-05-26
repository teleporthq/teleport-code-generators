import {
  ProjectUIDL,
  ComponentUIDL,
  ProjectValidationError,
  ComponentValidationError,
} from '@teleporthq/teleport-types'
import componentValidator from '../decoders/component-decoder'
import projectUIDLValidator from '../decoders/project-decoder'
import * as utils from './utils'

interface ValidationResult {
  valid: boolean
  errorMsg: string
}

export default class Validator {
  public validateComponentSchema(input: unknown): ValidationResult {
    const valid = componentValidator.run(input)

    if (valid.ok) {
      return { valid: true, errorMsg: '' }
    }
    // TODO: change the format for error messages to display
    const errorMsg = utils.formatErrors([])
    throw new ComponentValidationError(errorMsg)
  }

  // @ts-ignore
  public validateProjectSchema(input: Record<string, unknown>): ValidationResult {
    const valid = projectUIDLValidator.runWithException(input)

    if (!valid) {
      const errorMessage = utils.formatErrors([])
      throw new ProjectValidationError(errorMessage)
    }

    return { valid: true, errorMsg: '' }
  }

  public validateComponentContent(input: ComponentUIDL): ValidationResult {
    const errorsInDefinitions = utils.checkDynamicDefinitions(
      (input as unknown) as Record<string, unknown>
    )
    const errorsWithLocalVariables = utils.checkForLocalVariables(input)

    utils.checkForDuplicateDefinitions(input)
    const errors = [...errorsInDefinitions, ...errorsWithLocalVariables]

    if (errors.length > 0) {
      throw new ComponentValidationError(
        `UIDL Component Content Validation Error. Please check the following: \n${errors}`
      )
    }

    return { valid: true, errorMsg: '' }
  }

  public validateProjectContent(input: ProjectUIDL): ValidationResult {
    const errorsOnRouteNode = utils.checkRouteDefinition(input) || []
    let allErrors = errorsOnRouteNode

    if (errorsOnRouteNode.length === 0) {
      const errorsInStyleSet = utils.checkProjectStyleSet(input)
      const errorsInRootComponent = utils.checkRootComponent(input)

      const errorsWithComponentNaming = utils.checkComponentNaming(input)
      const errorsWtihComponentExistence = utils.checkComponentExistence(input)

      allErrors = [
        ...errorsOnRouteNode,
        ...errorsWtihComponentExistence,
        ...errorsWithComponentNaming,
        ...errorsInRootComponent,
        ...errorsInStyleSet,
      ]
    }

    if (allErrors.length > 0) {
      throw new ProjectValidationError(
        `UIDL Project Content Validation Error. Please check the following: ${allErrors}`
      )
    }

    return { valid: true, errorMsg: '' }
  }
}
