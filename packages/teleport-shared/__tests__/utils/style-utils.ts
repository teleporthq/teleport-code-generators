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

      const result = getContentOfStyleObject(styleValue)
      expect(result).toEqual({ test: { testAgain: { someKey: 'value' } } })
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
      const result = getContentOfStyleObject(styleValue)
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
