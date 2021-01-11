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
import uidlWithNull from './component-uidl-with-null-undefined.json'

import {
  component,
  definition,
  repeatNode,
  dynamicNode,
  elementNode,
} from '@teleporthq/teleport-uidl-builders'

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
  it('Component UIDL with null /  undefined in the JSON', () => {
    const validator = new Validator()
    expect(() =>
      validator.validateComponentSchema((uidlWithNull as unknown) as Record<string, unknown>)
    ).toThrow(Error)
  })

  describe('Component UIDL Format', () => {
    it('returns object with valid=true and errorMsg="" if uidl is valid', () => {
      const validator = new Validator()
      const validationResult = validator.validateComponentSchema(
        (uidl as unknown) as Record<string, unknown>
      )

      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(true)
      expect(validationResult.errorMsg).toEqual('')
      expect(typeof validationResult.componentUIDL).toBe('object')
    })

    it('returns customized errors', () => {
      const validator = new Validator()
      expect(() => validator.validateComponentSchema(invalidComponentUidlSample)).toThrow(Error)
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
      // @ts-ignore
      expect(() => validator.validateComponentContent(invalidComponentUidlSample)).toThrow(Error)

      //       expect(validationResult.errorMsg).toBe(
      //         `\nUIDL Component Content Validation Error. Please check the following:
      // "titles" is used but not defined. Please add it in propDefinitions,
      // "isVisibles" is used but not defined. Please add it in stateDefinitions,
      // Index variable is used but the "useIndex" meta information is false.,
      // "item" is used in the "repeat" structure but the iterator name has this value: "item-test"`
      //       )
    })

    it('throws error if prop and state is used but not defined in propDefinitions', () => {
      const validator = new Validator()
      // @ts-ignore
      expect(() => validator.validateComponentContent(invalidComponentUidlSample)).toThrow(Error)

      //       expect(validationResult.errorMsg).toBe(
      //         `\nUIDL Component Content Validation Error. Please check the following:
      // "titles" is used but not defined. Please add it in propDefinitions,
      // "isVisibles" is used but not defined. Please add it in stateDefinitions,
      // Index variable is used but the "useIndex" meta information is false.,
      // "item" is used in the "repeat" structure but the iterator name has this value: "item-test"`
      //       )
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
      expect(typeof validationResult.projectUIDL).toBe('object')
    })

    it('returns customized error', () => {
      const validator = new Validator()
      expect(() => validator.validateProjectSchema(invalidProjectUidlSample)).toThrow(Error)

      //   expect(validationResult.errorMsg).toBe(
      //     `\nUIDL Format Validation Error. Please check the following:
      //  - Path input: the key 'name' is required but was not present.
      //    is a DecoderError`
      //   )
    })

    it('supports older UIDL version and returns customized error', () => {
      const validator = new Validator()
      expect(() => validator.validateProjectSchema(oldInvalidProjectUidlSample)).toThrow(Error)

      // expect(validationResult.errorMsg).toBe(
      //   `\nUIDL Format Validation Error. Please check the following:
      //         - Path input: the key 'name' is required but was not present.
      //         is a DecoderError`
      // )
    })
  })

  describe('Project UIDL Content', () => {
    it('returns object with valid=true and errorMsg="" if uidl content is valid', () => {
      const validator = new Validator()
      // @ts-ignore
      const validationResult = validator.validateProjectContent(projectUidlSample)

      expect(typeof validationResult).toBe('object')
      expect(validationResult.valid).toEqual(true)
      expect(validationResult.errorMsg).toEqual('')
    })

    it('returns customized error if content is not properly defined', () => {
      const validator = new Validator()
      // @ts-ignore
      expect(() => validator.validateProjectContent(invalidProjectUidlSample)).toThrow(Error)

      //       expect(validationResult.errorMsg).toEqual(
      //         `\nUIDL Project Content Validation Error. Please check the following:
      // The component "Navbars" is not defined in the UIDL's component section.,
      // The following components have different name than their key: Navbar,OneComponent,
      // Root Node contains elements of type "static". It should contain only elements of type "conditional",
      // Root Node contains a route that don't have a specified state: abouts.`
      //       )
    })

    it('returns error if route is missing from state definitions', () => {
      const validator = new Validator()
      // @ts-ignore
      expect(() => validator.validateProjectContent(noRouteProjectUidlSample)).toThrow(Error)

      // expect(validationResult.errorMsg).toEqual(
      //   `\nUIDL Project Content Validation Error. Please check the following: Route is not defined in stateDefinitions`
      // )
    })
  })
})
