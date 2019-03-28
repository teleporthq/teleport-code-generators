import { validateComponent, validateProject } from '../../src/uidl-definitions/validators'
// @ts-ignore
import componentSample from '../fixtures/component-sample.json'
// @ts-ignore
import projectSample from '../fixtures/project-sample.json'

describe('component validation', () => {
  describe('valid', () => {
    it('return true', () => {
      expect(validateComponent(componentSample)).toBe(true)
    })
  })
  describe('invalid', () => {
    const badUIDL = {
      name: 'badUIDL',
      type: 'this should not be here',
    }

    it('return array of validation errors', () => {
      expect(validateComponent(badUIDL)).toBeInstanceOf(Array)
    })
  })
})

describe('project validation', () => {
  describe('valid', () => {
    it('return true', () => {
      expect(validateProject(projectSample)).toBe(true)
    })
  })
  describe('invalid', () => {
    it('return array of validation errors', () => {
      expect(validateProject(componentSample)).toBeInstanceOf(Array)
    })
  })
})
