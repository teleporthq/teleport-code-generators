import { generateStyledJSXTag } from '../src/utils'

describe('generateStyledJSXTag', () => {
  it('returns JSXTag', () => {
    const result = generateStyledJSXTag('randomString')

    expect(result.type).toBe('JSXElement')
    expect(result.openingElement.type).toBe('JSXOpeningElement')
    expect(result.openingElement.name).toHaveProperty('name', 'style')
    expect(result.closingElement.type).toBe('JSXClosingElement')
    expect(result.closingElement.name).toHaveProperty('name', 'style')
  })
})
