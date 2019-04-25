import { createCSSClass } from '../../src/utils/jss-utils'

describe('JSS Class Generation', () => {
  it('with empty styles', () => {
    expect(createCSSClass('name', {})).toEqual('')
  })

  it('with static styles', () => {
    expect(
      createCSSClass('name', {
        someKey: {
          type: 'static',
          content: 'value',
        },
      })
    ).toEqual(`.name {
  some-key: value;
}`)
  })

  it('with nested styles', () => {
    const stringContent = createCSSClass('name', {
      '@media (max-width: 835px)': {
        type: 'nested-style',
        content: {
          someKey: {
            type: 'static',
            content: 'value',
          },
        },
      },
    })
    expect(stringContent).toContain('@media (max-width: 835px)')
    expect(stringContent).toContain('some-key')
  })

  it('with multi nested styles', () => {
    const stringContent = createCSSClass('name', {
      '@media (max-width: 835px)': {
        type: 'nested-style',
        content: {
          '@media (max-width: 111px)': {
            type: 'nested-style',
            content: {
              someKey: {
                type: 'static',
                content: 'value',
              },
            },
          },
        },
      },
    })
    expect(stringContent).toContain('@media (max-width: 835px)')
    expect(stringContent).toContain('@media (max-width: 111px)')
    expect(stringContent).toContain('some-key')
  })
})
