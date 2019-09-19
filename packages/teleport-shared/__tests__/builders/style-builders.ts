import { createCSSClass } from '../../src/builders/style-builders'

describe('CSS Class Generation', () => {
  it('with empty styles', () => {
    expect(createCSSClass('name', {})).toEqual('')
  })

  it('with static styles', () => {
    const result = createCSSClass('name', {
      someKey: 'value',
      otherKey: 'otherValue',
    })
    expect(result).toEqual(`.name {
  some-key: value;
  other-key: otherValue;
}`)
  })
})
