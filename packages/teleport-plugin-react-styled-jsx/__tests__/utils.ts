import { generateStyledJSXTag } from '../src/utils'

describe('generateStyledJSXTag', () => {
  it('returns JSXTag', async () => {
    const result = await generateStyledJSXTag('randomString')

    expect(result.type).toBe('JSXElement')
    expect(result.openingElement.type).toBe('JSXOpeningElement')
    expect(result.openingElement.name).toHaveProperty('name', 'style')
    expect(result.closingElement.type).toBe('JSXClosingElement')
    expect(result.closingElement.name).toHaveProperty('name', 'style')
  })
})
