import { cleanupDynamicStyles } from '../../../../src/shared/utils/uidl-utils'
import { StyleDefinitions } from '../../../../src/typings/uidl-definition'

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
