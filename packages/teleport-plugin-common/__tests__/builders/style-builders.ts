import { createCSSClass, createCSSClassWithSelector } from '../../src/builders/style-builders'

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

  it('with subselectors', () => {
    const result = createCSSClassWithSelector('name', '& h1 > h2 .ab.cd #id', {
      someKey: 'value',
      otherKey: 'otherValue',
    })
    expect(result).toEqual(`.name h1 > h2 .ab.cd #id {
  some-key: value;
  other-key: otherValue;
}`)
  })
})
