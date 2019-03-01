import {
  slugify,
  addSpacesToEachLine,
  removeLastEmptyLine,
} from '../../../../src/shared/utils/string-utils'

describe('Shared Utils string helpers', () => {
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

  describe('addSpacesToEachLine', () => {
    it('works on a single line', () => {
      expect(addSpacesToEachLine(2, 'test')).toBe('  test')
    })

    it('works on multiple lines', () => {
      const multilineText = `This
is a multiline
text`

      const expectedResult = `  This
  is a multiline
  text`

      expect(addSpacesToEachLine(2, multilineText)).toBe(expectedResult)
    })

    it('adds to existing spaces', () => {
      const multilineText = `This
is a multiline
text
  with some indentation
here
    and there`

      const expectedResult = `  This
  is a multiline
  text
    with some indentation
  here
      and there`

      expect(addSpacesToEachLine(2, multilineText)).toBe(expectedResult)
    })
  })

  describe('removeLastEmptyLine', () => {
    it('does not change the string is there is no empty line', () => {
      expect(removeLastEmptyLine('test\ntest')).toBe('test\ntest')
    })

    it('removes empty line at the end', () => {
      expect(removeLastEmptyLine('test\n')).toBe('test')
    })

    it('removes only empty line at the end', () => {
      expect(removeLastEmptyLine('test\ntest\n')).toBe('test\ntest')
    })
  })
})
