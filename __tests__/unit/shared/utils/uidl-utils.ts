import {
  cleanupDynamicStyles,
  isUIDLDynamicReference,
} from '../../../../src/shared/utils/uidl-utils'

describe('cleanupDynamicStyles', () => {
  const styleObject = {
    margin: '20px',
    padding: '$props.padding',
    ':hover': {
      margin: '10px',
      padding: '$props.hoverPadding',
    },
  }

  it('removes dynamic styles from nested style objects', () => {
    const cleanedStyle = cleanupDynamicStyles(styleObject) as StyleDefinitions
    expect(cleanedStyle.padding).toBeUndefined()
    expect(cleanedStyle.margin).toBe('20px')
    const nestedStyle = cleanedStyle[':hover'] as StyleDefinitions
    expect(nestedStyle.padding).toBeUndefined()
    expect(nestedStyle.margin).toBe('10px')
  })
})

describe('isUIDLDynamicReference', () => {
  const validDynamicReference: UIDLDynamicReference = {
    type: 'dynamic',
    content: {
      referenceType: 'prop',
      id: 'children',
    },
  }

  const invalidReference = '$props.children'

  it('returns valid object back, falsty otherwise', () => {
    expect(isUIDLDynamicReference(validDynamicReference)).toEqual(validDynamicReference)
    expect(isUIDLDynamicReference(invalidReference)).toBeFalsy()
  })
})
