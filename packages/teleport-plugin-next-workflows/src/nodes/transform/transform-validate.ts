import { NodeHandlerGenerator, handlerToString } from '../types'

async function transform_validate(config: any, context: Record<string, unknown>) {
  const input = config.input || {}
  const rules = config.rules || []
  const stopOnFirstError = config.stopOnFirstError || false
  const errors = []

  try {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i]
      const field = rule.field
      const fieldValue = input[field]
      const ruleType = rule.rule
      const errorMsg = rule.message || 'Validation failed for field: ' + field
      let valid = true

      switch (ruleType) {
        case 'required':
          valid = fieldValue !== undefined && fieldValue !== null && fieldValue !== ''
          break
        case 'email':
          valid = typeof fieldValue === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fieldValue)
          break
        case 'min':
          if (typeof fieldValue === 'number') {
            valid = fieldValue >= Number(rule.min)
          } else if (typeof fieldValue === 'string') {
            valid = fieldValue.length >= Number(rule.min)
          }
          break
        case 'max':
          if (typeof fieldValue === 'number') {
            valid = fieldValue <= Number(rule.max)
          } else if (typeof fieldValue === 'string') {
            valid = fieldValue.length <= Number(rule.max)
          }
          break
        case 'range':
          const numVal = Number(fieldValue)
          valid = numVal >= Number(rule.min) && numVal <= Number(rule.max)
          break
        case 'pattern':
          valid = typeof fieldValue === 'string' && new RegExp(rule.pattern).test(fieldValue)
          break
        case 'type':
          valid = typeof fieldValue === rule.value
          break
        case 'in':
          const allowed = rule.allowedValues || []
          valid = false
          for (let a = 0; a < allowed.length; a++) {
            if (fieldValue === allowed[a]) {
              valid = true
              break
            }
          }
          break
        case 'url':
          try {
            new URL(String(fieldValue))
            valid = true
          } catch (e) {
            valid = false
          }
          break
        case 'date':
          const d = new Date(fieldValue)
          valid = !isNaN(d.getTime())
          break
        case 'date-before':
          const db = new Date(fieldValue)
          const dc = new Date(rule.dateToCompare)
          valid = !isNaN(db.getTime()) && !isNaN(dc.getTime()) && db < dc
          break
        case 'date-after':
          const da = new Date(fieldValue)
          const dac = new Date(rule.dateToCompare)
          valid = !isNaN(da.getTime()) && !isNaN(dac.getTime()) && da > dac
          break
        case 'length':
          if (typeof fieldValue === 'string' || Array.isArray(fieldValue)) {
            valid = fieldValue.length === Number(rule.value)
          } else {
            valid = false
          }
          break
        case 'numeric':
          valid = !isNaN(Number(fieldValue)) && fieldValue !== null && fieldValue !== ''
          break
        case 'alpha':
          valid = typeof fieldValue === 'string' && /^[a-zA-Z]+$/.test(fieldValue)
          break
        case 'alphanumeric':
          valid = typeof fieldValue === 'string' && /^[a-zA-Z0-9]+$/.test(fieldValue)
          break
        default:
          valid = false
      }

      if (!valid) {
        errors.push({ id: rule.id || i, field, rule: ruleType, message: errorMsg })
        if (stopOnFirstError) {
          break
        }
      }
    }

    return { isValid: errors.length === 0, errors }
  } catch (err: unknown) {
    return { isValid: false, errors: [{ message: (err as Error).message }] }
  }
}
export const transformValidate: NodeHandlerGenerator = {
  nodeType: 'transform-validate',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(transform_validate)
  },
}
