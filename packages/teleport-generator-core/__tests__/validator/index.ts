import { Validator } from '../../src'

// @ts-ignore
import invalidComponentUidlSample from './component-invalid-sample.json'
// @ts-ignore
import projectUidlSample from './project-sample.json'
// @ts-ignore
import invalidProjectUidlSample from './project-invalid-sample.json'

import {
  component,
  definition,
  repeatNode,
  dynamicNode,
  elementNode,
} from '@teleporthq/teleport-generator-shared/lib/builders/uidl-builders'

const uidl = component(
  'Repeat Component',
  elementNode('container', {}, [
    repeatNode(
      elementNode('div', {}, [dynamicNode('local', 'item')]),
      dynamicNode('prop', 'items'),
      {
        useIndex: true,
      }
    ),
  ]),
  { items: definition('array', ['hello', 'world']) },
  { items: definition('array', ['hello', 'world']) }
)

describe('Validate UIDL', () => {
  describe('Component UIDL Format', () => {
    it('returns object with valid=true and errorMsg="" if uidl is valid', () => {
      const validator = new Validator()
      const validationResult = validator.validateComponentSchema(uidl)
      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(true)
      expect(validationResult.errorMsg).toEqual('')
    })
    it('returns customized errors', () => {
      const validator = new Validator()
      const validationResult = validator.validateComponentSchema(invalidComponentUidlSample)
      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(false)
      expect(validationResult.errorMsg).toBe(
        `\nUIDL Format Validation Error. Please check the following: 
 - Path .stateDefinitions['isVisible']: should NOT have additional properties. {"additionalProperty":"test"},
 - Path .stateDefinitions['test']: should have required property 'defaultValue'. {\"missingProperty\":\"defaultValue\"},
 - Path .stateDefinitions['test']: should NOT have additional properties. {\"additionalProperty\":\"defaultValues\"},
 - Path .propDefinitions['test']: should NOT have additional properties. {"additionalProperty":"defaultValues"}`
      )
    })
  })

  describe('Component UIDL COntent', () => {
    it('returns object with valid=true and errorMSG="" if everything is ok', () => {
      const validator = new Validator()
      const validationResult = validator.validateComponentContent(uidl)
      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(true)
      expect(validationResult.errorMsg).toEqual('')
    })
    it('throws error if prop is used but not defined in propDefinitions', () => {
      const validator = new Validator()
      const validationResult = validator.validateComponentContent(invalidComponentUidlSample)
      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(false)
      expect(validationResult.errorMsg).not.toEqual('')
      expect(validationResult.errorMsg).toBe(
        `\nUIDL Content Validation Error. Please check the following: \n"titles" is used as prop but not defined. Please add it in propDefinitions`
      )
    })
    it('does not throw error if props and states have same keys', () => {
      const validator = new Validator()
      const warn = jest.spyOn(global.console, 'warn')

      const validationResult = validator.validateComponentContent(uidl)

      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(true)
      expect(validationResult.errorMsg).toEqual('')
      expect(warn).toHaveBeenCalled()
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
        `\nUIDL Format Validation Error. Please check the following: 
 - Path : should have required property 'name'. {"missingProperty":"name"},
 - Path .globals.settings: should NOT have additional properties. {"additionalProperty":"key"},
 - Path .globals.settings.language: should be string. Received number,
 - Path .globals.assets[1].type: should be equal to one of the allowed values. {"allowedValues":["link","script","font","icon","style"]}`
      )
    })
  })
})
