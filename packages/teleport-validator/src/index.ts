import Ajv from 'ajv'
import componentSchema from '@teleporthq/teleport-uidl-definitions/lib/schemas/component.json'
import projectSchema from '@teleporthq/teleport-uidl-definitions/lib/schemas/project.json'

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

  public validateComponent(input: any): ValidationResult {
    const valid = this.componentValidator(input)
    if (!valid && this.componentValidator.errors) {
      return { valid: false, errorMsg: formatErrors(this.componentValidator.errors) }
    }

    return { valid: true, errorMsg: '' }
  }

  public validateProject(input: Record<string, unknown>): ValidationResult {
    const valid = this.projectValidator(input)

    if (!valid && this.projectValidator.errors) {
      return { valid: false, errorMsg: formatErrors(this.projectValidator.errors) }
    }

    return { valid: true, errorMsg: '' }
  }
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

  return `UIDL Validation error. Please check the following: ${listOfErrors}`
}
