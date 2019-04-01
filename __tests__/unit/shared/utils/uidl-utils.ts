import {
  cleanupDynamicStyles,
  isUIDLDynamicReference,
} from '../../../../src/shared/utils/uidl-utils'

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
