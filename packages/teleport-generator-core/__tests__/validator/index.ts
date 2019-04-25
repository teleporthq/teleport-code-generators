import { Validator } from '../../src'

import componentUidlSample from '../../../../__tests__/fixtures/component-sample.json'
import invalidComponentUidlSample from '../../../../__tests__/fixtures/component-invalid-sample.json'
import multiErrorsInvalidComponentUidlSample from '../../../../__tests__/fixtures/component-invalid-sample-multiple-errors.json'

import projectUidlSample from '../../../../__tests__/fixtures/project-sample.json'
import invalidProjectUidlSample from '../../../../__tests__/fixtures/project-invalid-sample.json'

describe('Validate UIDL', () => {
  describe('Component UIDL', () => {
    it('returns object with valid=true and errorMsg="" if uidl is valid', () => {
      const validator = new Validator()
      const validationResult = validator.validateComponent(componentUidlSample)
      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(true)
      expect(validationResult.errorMsg).toEqual('')
    })
    it('returns customized error', () => {
      const validator = new Validator()
      const validationResult = validator.validateComponent(invalidComponentUidlSample)
      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(false)
      expect(validationResult.errorMsg).toBe(
        `UIDL Validation error. Please check the following: 
 - Path .stateDefinitions['isVisible']: should NOT have additional properties. {"additionalProperty":"test"}`
      )
    })
    it('returns multiple customized errors', () => {
      const validator = new Validator()
      const validationResult = validator.validateComponent(multiErrorsInvalidComponentUidlSample)
      const expectedErrorMsg = `UIDL Validation error. Please check the following: 
 - Path : should NOT have additional properties. {\"additionalProperty\":\"nodes\"},
 - Path : should have required property 'node'. {\"missingProperty\":\"node\"}`
      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(false)
      expect(validationResult.errorMsg).toBe(expectedErrorMsg)
    })
  })

  describe('Project UIDL', () => {
    it('returns object with valid=true and errorMsg="" if uidl is valid', () => {
      const validator = new Validator()
      const validationResult = validator.validateProject(projectUidlSample)

      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(true)
      expect(validationResult.errorMsg).toEqual('')
    })
    it('returns customized error', () => {
      const validator = new Validator()
      const validationResult = validator.validateProject(invalidProjectUidlSample)
      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(false)
      expect(validationResult.errorMsg).toBe(
        `UIDL Validation error. Please check the following: 
 - Path : should have required property 'name'. {"missingProperty":"name"},
 - Path .globals.settings: should NOT have additional properties. {"additionalProperty":"key"},
 - Path .globals.settings.language: should be string. Received number,
 - Path .globals.assets[1].type: should be equal to one of the allowed values. {"allowedValues":["link","script","font","icon","style"]}`
      )
    })
  })
})
