interface ValidationResult {
  valid: boolean
  errorMsg: string
}
export default class Validator {
  private componentValidator
  private projectValidator
  constructor()
  validateComponent(input: any): ValidationResult
  validateProject(input: Record<string, unknown>): ValidationResult
}
export {}
