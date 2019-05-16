import Ajv from 'ajv'
import componentSchema from '../uidl-schemas/component.json'
import projectSchema from '../uidl-schemas/project.json'

import { traverseNodes } from '@teleporthq/teleport-generator-shared/lib/utils/uidl-utils'

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

  public validateProject(input: Record<string, unknown>): ValidationResult {
    const valid = this.projectValidator(input)

    if (!valid && this.projectValidator.errors) {
      return { valid: false, errorMsg: formatErrors(this.projectValidator.errors) }
    }

    return { valid: true, errorMsg: '' }
  }

  public validateComponentContent(input: any): ValidationResult {
    const verifyProps = checkContent(input, 'prop')
    const verifyState = checkContent(input, 'state')

    checkForDuplicates(input)
    const errors = verifyProps.errors.concat(verifyState.errors)

    if (errors.length > 0) {
      return {
        valid: false,
        errorMsg: `\nUIDL Content Validation Error. Please check the following: \n${errors}`,
      }
    }

    return { valid: true, errorMsg: '' }
  }
}

const checkForDuplicates = (input: any) => {
  const props = Object.keys(input.propDefinitions || [])
  const states = Object.keys(input.stateDefinitions || [])

  const duplicates = props.filter((x) => states.includes(x))

  if (duplicates.length > 0) {
    duplicates.map((duplicate) =>
      console.warn(
        `"${duplicate}" is defined both as a prop and as a state. If you are using VUE Code Generators this can cause bad behavior.`
      )
    )
  }
}

const checkContent = (input: any, type: string) => {
  const definitions = `${type}Definitions`
  const definedKeys = Object.keys(input[definitions] || [])
  const usedKeys = []
  const errors = []

  traverseNodes(input.node, (node) => {
    if (node.type === 'dynamic' && node.content.referenceType === type) {
      if (!definedKeys.includes(node.content.id)) {
        const errorMsg = `"${
          node.content.id
        }" is used as ${type} but not defined. Please add it in ${definitions}`
        errors.push(errorMsg)
      }
      usedKeys.push(node.content.id)
    }
  })

  const diffs = definedKeys.filter((x) => !usedKeys.includes(x))
  if (diffs.length > 0) {
    diffs.map((diff) => {
      console.warn(`${type} "${diff}" is defined in ${definitions} but it is not used in the UIDL.`)
    })
  }

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
