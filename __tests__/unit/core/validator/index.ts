import { Validator } from '../../../../src/core'

import uidlSample from '../../../fixtures/component-sample.json'
import invalidUidlSample from '../../../fixtures/component-invalid-sample.json'
import multiErrorsInvalidUidlSample from '../../../fixtures/component-invalid-sample-multiple-errors.json'

describe('Validate UIDL', () => {
  it('returns object with valid=true and errorMsg="" if uidl is valid', () => {
    const validator = new Validator()
    const validationResult = validator.validateComponent(uidlSample)

    expect(typeof validationResult).toBe('object')
    expect(validationResult.valid).toEqual(true)
    expect(validationResult.errorMsg).toEqual('')
  })
  it('returns customized error', () => {
    const validator = new Validator()
    const validationResult = validator.validateComponent(invalidUidlSample)
    console.log('validationResult', validationResult)
    expect(typeof validationResult).toBe('object')
    expect(validationResult.valid).toEqual(false)
    expect(validationResult.errorMsg).toBe(
      'UIDL Validation error. Please check the following: \n - Path .content: should NOT have additional properties. {"additionalProperty":"key"}'
    )
  })
  it('returns multiple customized errors', () => {
    const validator = new Validator()
    const validationResult = validator.validateComponent(multiErrorsInvalidUidlSample)
    const expectedErrorMsg = `UIDL Validation error. Please check the following: 
 - Path .content: should NOT have additional properties. {"additionalProperty":"types"},
 - Path .content: should NOT have additional properties. {"additionalProperty":"key"},
 - Path .content: should have required property \'type\'. {"missingProperty":"type"},
 - Path .stateDefinitions[\'activeTab\'].type: should be string. Received number,
 - Path .stateDefinitions[\'activeTab\'].type: should be equal to one of the allowed values. {"allowedValues":["string","boolean","number","object","func","array","router"]},
 - Path .propDefinitions[\'test\'].type: should be equal to one of the allowed values. {"allowedValues":["string","boolean","number","array","func","object","children"]}`
    expect(typeof validationResult).toBe('object')
    expect(validationResult.valid).toEqual(false)
    expect(validationResult.errorMsg).toBe(expectedErrorMsg)
  })
})
