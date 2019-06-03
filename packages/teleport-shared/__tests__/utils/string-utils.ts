import {
  slugify,
  addSpacesToEachLine,
  removeLastEmptyLine,
  sanitizeVariableName,
  camelCaseToDashCase,
  dashCaseToUpperCamelCase,
  dashCaseToCamelCase,
} from '../../src/utils/string-utils'

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
    expect(addSpacesToEachLine('  ', 'test')).toBe('  test')
  })

  it('works on multiple lines', () => {
    const multilineText = `This
is a multiline
text`

    const expectedResult = `  This
  is a multiline
  text`

    expect(addSpacesToEachLine('  ', multilineText)).toBe(expectedResult)
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

    expect(addSpacesToEachLine('  ', multilineText)).toBe(expectedResult)
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

describe('sanitizeVariableName', () => {
  it('does not change a valid string', () => {
    expect(sanitizeVariableName('ComponentName')).toBe('ComponentName')
  })

  it('removes spaces and other characters, but keeps underscore', () => {
    expect(sanitizeVariableName('Component_ Name-')).toBe('Component_Name')
  })
})

describe('camelCaseToDashCase', () => {
  it('works with upper case', () => {
    expect(camelCaseToDashCase('PrimaryButton')).toBe('primary-button')
  })

  it('works with lower case', () => {
    expect(camelCaseToDashCase('primaryButton')).toBe('primary-button')
  })

  it('does not affect a dash case string', () => {
    expect(camelCaseToDashCase('primary-button')).toBe('primary-button')
  })

  it('ignores numbers', () => {
    expect(camelCaseToDashCase('1prim12arybutton')).toBe('1prim12arybutton')
  })

  it('should revert a dash to camel case transition', () => {
    expect(camelCaseToDashCase(dashCaseToCamelCase('primary-button'))).toBe('primary-button')
  })
})

describe('dashCaseToUpperCamelCase', () => {
  it('works', () => {
    expect(dashCaseToUpperCamelCase('primary-button')).toBe('PrimaryButton')
  })

  it('works with a dash at the end', () => {
    expect(dashCaseToUpperCamelCase('primary-button-')).toBe('PrimaryButton')
  })

  it('works with a dash at the beginning', () => {
    expect(dashCaseToUpperCamelCase('-primary-button')).toBe('PrimaryButton')
  })

  it('does not change a camel case string', () => {
    expect(dashCaseToUpperCamelCase('PrimaryButton')).toBe('PrimaryButton')
  })

  it('does change a lower camel case to upper camel case string', () => {
    expect(dashCaseToUpperCamelCase('primaryButton')).toBe('PrimaryButton')
  })
})

describe('dashCaseToCamelCase', () => {
  it('works', () => {
    expect(dashCaseToCamelCase('primary-button')).toBe('primaryButton')
  })

  it('works with a dash at the end', () => {
    expect(dashCaseToCamelCase('primary-button-')).toBe('primaryButton')
  })

  it('works with a dash at the beginning', () => {
    expect(dashCaseToCamelCase('-primary-button')).toBe('PrimaryButton')
  })

  it('does not change a camel case string', () => {
    expect(dashCaseToCamelCase('primaryButton')).toBe('primaryButton')
  })

  it('doesn`t change a upper camel case to lower camel case', () => {
    expect(dashCaseToCamelCase('PrimaryButton')).toBe('PrimaryButton')
  })
})
