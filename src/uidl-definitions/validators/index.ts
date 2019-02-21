import Ajv from 'ajv'
import componentSchema from '../schemas/component.json'
import projectSchema from '../schemas/project.json'

const ajv = new Ajv()

const componentValidator = ajv.compile(componentSchema)
const projectValidator = ajv.compile(projectSchema)

export const validateComponent = (input: any) => {
  const valid = componentValidator(input)
  if (!valid && componentValidator.errors) {
    return componentValidator.errors
  }

  return true
}

export const validateProject = (input: any) => {
  const valid = projectValidator(input)
  if (!valid && projectValidator.errors) {
    return projectValidator.errors
  }

  return true
}
