import { Validator } from '../../src'

// @ts-ignore
import invalidComponentUidlSample from './component-invalid-sample.json'
// @ts-ignore
import projectUidlSample from './project-sample.json'
// @ts-ignore
import oldInvalidProjectUidlSample from './old-project-invalid-sample.json'
// @ts-ignore
import invalidProjectUidlSample from './project-invalid-sample.json'
// @ts-ignore
import noRouteProjectUidlSample from './project-invalid-sample-no-route.json'
import {
  component,
  definition,
  repeatNode,
  dynamicNode,
  elementNode,
} from '@teleporthq/teleport-shared/lib/builders/uidl-builders'

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

  describe('Component UIDL Content', () => {
    it('returns object with valid=true and errorMSG="" if everything is ok', () => {
      const validator = new Validator()
      const validationResult = validator.validateComponentContent(uidl)
      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(true)
      expect(validationResult.errorMsg).toEqual('')
    })
    it('throws error if prop and state is used but not defined in propDefinitions', () => {
      const validator = new Validator()
      const validationResult = validator.validateComponentContent(invalidComponentUidlSample)
      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(false)
      expect(validationResult.errorMsg).not.toEqual('')
      expect(validationResult.errorMsg).toBe(
        `\nUIDL Component Content Validation Error. Please check the following: 
"titles" is used but not defined. Please add it in propDefinitions,
"isVisibles" is used but not defined. Please add it in stateDefinitions,
Index variable is used but the "useIndex" meta information is false.,
"item" is used in the "repeat" structure but the iterator name has this value: "item-test"`
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

  describe('Project UIDL Format', () => {
    it('returns object with valid=true and errorMsg="" if uidl is valid', () => {
      const validator = new Validator()
      const validationResult = validator.validateProjectSchema(projectUidlSample)

      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(true)
      expect(validationResult.errorMsg).toEqual('')
    })
    it('returns customized error', () => {
      const validator = new Validator()
      const validationResult = validator.validateProjectSchema(invalidProjectUidlSample)
      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(false)
      expect(validationResult.errorMsg).toBe(
        `\nUIDL Format Validation Error. Please check the following: 
 - Path : should have required property 'name'. {"missingProperty":"name"},
 - Path .globals.settings: should NOT have additional properties. {"additionalProperty":"key"},
 - Path .globals.settings.language: should be string. Received number`
      )
    })
    it('supports older UIDL version and returns customized error', () => {
      const validator = new Validator()
      const validationResult = validator.validateProjectSchema(oldInvalidProjectUidlSample)
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

  describe('Project UIDL Content', () => {
    it('returns object with valid=true and errorMsg="" if uidl content is valid', () => {
      const validator = new Validator()
      const validationResult = validator.validateProjectContent(projectUidlSample)

      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(true)
      expect(validationResult.errorMsg).toEqual('')
    })
    it('returns customized error if content is not properly defined', () => {
      const validator = new Validator()
      const validationResult = validator.validateProjectContent(invalidProjectUidlSample)

      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(false)
      expect(validationResult.errorMsg).toEqual(
        `\nUIDL Project Content Validation Error. Please check the following: 
The component "Navbars" is not defined in the UIDL's component section.,
The following components have different name than their key: Navbar,OneComponent,
Root Node contains elements of type "static". It should contain only elements of type "conditional",
Root Node contains routes that don't have corresponding components. Check the "value" for the following routes: /about.`
      )
    })
    it('returns error if route is missing from state definitions', () => {
      const validator = new Validator()
      const validationResult = validator.validateProjectContent(noRouteProjectUidlSample)

      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(false)
      expect(validationResult.errorMsg).toEqual(
        `\nUIDL Project Content Validation Error. Please check the following: Route is not defined in stateDefinitions`
      )
    })
  })
})
