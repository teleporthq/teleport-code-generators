import { getContentOfStyleObject } from '../../src/utils/style-utils'
import { UIDLStyleDefinitions } from '@teleporthq/teleport-types'

describe('JSS Utils ', () => {
  describe('getContentOfStyleObject', () => {
    it('with static', () => {
      const styleValue: UIDLStyleDefinitions = {
        color: {
          type: 'static',
          content: 'red',
        },
      }
      const result = getContentOfStyleObject(styleValue)
      expect(result).toEqual({ color: 'red' })
    })

    it('with nested-style', () => {
      const styleValue: UIDLStyleDefinitions = {
        test: {
          type: 'nested-style',
          content: {
            testAgain: {
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
      }

      expect(() => getContentOfStyleObject(styleValue)).toThrow(Error)
    })
  })

  it('drops a value with unbalanced parentheses (truncated color-mix)', () => {
    const styleValue: UIDLStyleDefinitions = {
      color: {
        type: 'static',
        content: 'color-mix(in srgb, var(--color-surface) 50%,',
      },
      display: {
        type: 'static',
        content: 'flex',
      },
    }
    // The corrupted `color` is dropped; the surrounding rule stays parseable.
    expect(getContentOfStyleObject(styleValue)).toEqual({ display: 'flex' })
  })

  it('drops a value with a stray closing parenthesis', () => {
    const styleValue: UIDLStyleDefinitions = {
      width: {
        type: 'static',
        content: 'calc(100% - 10px))',
      },
    }
    expect(getContentOfStyleObject(styleValue)).toEqual({})
  })

  it('keeps valid values with balanced nested parentheses', () => {
    const styleValue: UIDLStyleDefinitions = {
      color: {
        type: 'static',
        content: 'color-mix(in srgb, var(--color-surface) 50%, transparent)',
      },
      background: {
        type: 'static',
        content: 'linear-gradient(90deg, rgba(0,0,0,0.5), #fff)',
      },
    }
    expect(getContentOfStyleObject(styleValue)).toEqual({
      color: 'color-mix(in srgb, var(--color-surface) 50%, transparent)',
      background: 'linear-gradient(90deg, rgba(0,0,0,0.5), #fff)',
    })
  })

  it('keeps values whose parentheses/colons live inside a quoted string', () => {
    const styleValue: UIDLStyleDefinitions = {
      background: {
        type: 'static',
        content: 'url("data:image/svg+xml;utf8,<svg viewBox=\'0 0 (1)\'></svg>")',
      },
      fontFamily: {
        type: 'static',
        content: '"Foo (Bold)", sans-serif',
      },
    }
    expect(getContentOfStyleObject(styleValue)).toEqual({
      background: 'url("data:image/svg+xml;utf8,<svg viewBox=\'0 0 (1)\'></svg>")',
      fontFamily: '"Foo (Bold)", sans-serif',
    })
  })

  it('fails with other type than static or nested-style', () => {
    const styleValue: UIDLStyleDefinitions = {
      content: {
        type: 'dynamic',
        content: {
          referenceType: 'prop',
          id: 'test',
        },
      },
    }
    try {
      getContentOfStyleObject(styleValue)
    } catch (e) {
      expect(e.message).toBe(
        `getContentOfStyleKey received unsupported ${JSON.stringify(
          styleValue.content,
          null,
          2
        )} UIDLNodeStyleValue value`
      )
    }
  })
})
