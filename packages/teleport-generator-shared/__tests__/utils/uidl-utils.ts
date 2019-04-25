import {
  cleanupDynamicStyles,
  transformStringAssignmentToJson,
  transformStylesAssignmentsToJson,
  transformAttributesAssignmentsToJson,
} from '../../src/utils/uidl-utils'
import { UIDLStyleDefinitions } from '../../src/typings/uidl'

// @ts-ignore
import uidlStyleJSON from './uidl-utils-style.json'

describe('cleanupDynamicStyles', () => {
  const styleObject = uidlStyleJSON as UIDLStyleDefinitions

  it('removes dynamic styles from nested style objects', () => {
    cleanupDynamicStyles(styleObject)
    const cleanedStyle = (cleanupDynamicStyles(styleObject) as unknown) as UIDLStyleDefinitions
    expect(cleanedStyle.padding).toBeUndefined()
    expect(cleanedStyle.margin.content).toBe('20px')
    const nestedStyle = (cleanedStyle[':hover'] as unknown) as UIDLStyleDefinitions
    expect((nestedStyle.content as Record<string, any>).padding).toBeUndefined()
    expect((nestedStyle.content as Record<string, any>).margin.content).toBe('10px')
  })
})

describe('transformStringAssignmentToJson', () => {
  const inputOutputMap = {
    '$props.direction': {
      type: 'dynamic',
      content: {
        referenceType: 'prop',
        id: 'direction',
      },
    },

    '$state.direction': {
      type: 'dynamic',
      content: {
        referenceType: 'state',
        id: 'direction',
      },
    },

    '$local.direction': {
      type: 'dynamic',
      content: {
        referenceType: 'local',
        id: 'direction',
      },
    },

    'static content 1': {
      type: 'static',
      content: `static content 1`,
    },
  }

  it('transforms props string to json', () => {
    Object.keys(inputOutputMap).forEach((key) => {
      expect(transformStringAssignmentToJson(key)).toEqual(inputOutputMap[key])
    })
  })
})

describe('transformStylesAssignmentsToJson', () => {
  it('transforms static styles to new json', () => {
    const inputStyle = {
      float: 'left',
    }

    const expectedStyle = {
      float: { type: 'static', content: 'left' },
    }

    expect(transformStylesAssignmentsToJson(inputStyle)).toEqual(expectedStyle)
  })

  it('leaves static styles json alone', () => {
    const inputStyle = {
      float: { type: 'static', content: 'left' },
      width: 32,
    }

    const expectedStyle = {
      float: { type: 'static', content: 'left' },
      width: { type: 'static', content: 32 },
    }

    expect(transformStylesAssignmentsToJson(inputStyle)).toEqual(expectedStyle)
  })

  it('leaves dynamic styles json alone', () => {
    const inputStyle = {
      width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
    }

    const expectedStyle = {
      width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
    }

    expect(transformStylesAssignmentsToJson(inputStyle)).toEqual(expectedStyle)
  })

  it('transforms dynamic styles to new json', () => {
    const inputStyle = {
      width: '$props.size',
    }

    const expectedStyle = {
      width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
    }

    expect(transformStylesAssignmentsToJson(inputStyle)).toEqual(expectedStyle)
  })

  it('transforms nested styles to new json', () => {
    const nestedStyle = {
      '@media(max-widht:300px)': {
        flex: '1 1 row',
        width: '$props.size',
      },
    }

    const expectedStyle = {
      '@media(max-widht:300px)': {
        type: 'nested-style',
        content: {
          flex: { type: 'static', content: '1 1 row' },
          width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
        },
      },
    }

    expect(transformStylesAssignmentsToJson(nestedStyle)).toEqual(expectedStyle)
  })

  it('transforms mixed styles to new json', () => {
    const nestedStyle = {
      '@media(max-widht:300px)': {
        flex: '1 1 row',
        width: '$props.size',
        parsedValue: {
          type: 'static',
          content: 'parsed',
        },
      },

      // already parsed, should be left untouched
      '@media(min-widht:300px)': {
        type: 'nested-style',
        content: {
          flex: { type: 'static', content: '1 1 row' },
          width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
          heght: '$props.size',
        },
      },
    }

    const expectedStyle = {
      '@media(max-widht:300px)': {
        type: 'nested-style',
        content: {
          flex: { type: 'static', content: '1 1 row' },
          width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
          parsedValue: {
            type: 'static',
            content: 'parsed',
          },
        },
      },

      '@media(min-widht:300px)': {
        type: 'nested-style',
        content: {
          flex: { type: 'static', content: '1 1 row' },
          width: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
          heght: { type: 'dynamic', content: { referenceType: 'prop', id: 'size' } },
        },
      },
    }

    expect(transformStylesAssignmentsToJson(nestedStyle)).toEqual(expectedStyle)
  })
})

describe('transformAttributesAssignmentsToJson', () => {
  it('transforms attrs styles to new json', () => {
    const inputStyle = {
      float: { type: 'static', content: 'left' },
      width: 32,
      height: '$state.expandedSize',
      flexDirection: { type: 'dynamic', content: { referenceType: 'prop', id: 'direction' } },
    }

    const expectedStyle = {
      float: { type: 'static', content: 'left' },
      width: { type: 'static', content: 32 },
      height: { type: 'dynamic', content: { referenceType: 'state', id: 'expandedSize' } },
      flexDirection: { type: 'dynamic', content: { referenceType: 'prop', id: 'direction' } },
    }

    expect(transformAttributesAssignmentsToJson(inputStyle)).toEqual(expectedStyle)
  })
})
