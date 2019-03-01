import { slugify } from '../../../../src/shared/utils/helpers'

describe('Component Generators Utils helpers', () => {
  describe('slugify tests', () => {
    it('check null input', async () => {
      expect(slugify(null)).toBe(null)
    })
    it('check empty input', async () => {
      expect(slugify('')).toBe('')
    })
    it('check uppercase', async () => {
      expect(slugify('TEST')).toBe('test')
    })
    it('check multiple words', async () => {
      expect(slugify('test multiple-words')).toBe('test-multiple-words')
    })
    it('check multiple ---', async () => {
      expect(slugify('---')).toBe('')
    })
    it('check multiple -- in string', async () => {
      expect(slugify('test--name')).toBe('test-name')
    })

    it('check trim', async () => {
      expect(slugify('   test   ')).toBe('test')
    })
    it('should return correct slug', async () => {
      expect(slugify('Project Name')).toBe('project-name')
    })
  })
})
