/*
    Styleset-Definitions have conditions which helps in applying media styles
    and pseudo styles on them. These need to be sorted as we do for referenced-Styles
*/

import { StringUtils } from '@teleporthq/teleport-shared'
import {
  GeneratorOptions,
  UIDLStyleSetDefinition,
  UIDLStyleSetMediaCondition,
  UIDLStyleSetStateCondition,
} from '@teleporthq/teleport-types'
import { prefixAssetURLs } from '../../utils'

const isValidStyleSetKey = (key: string): boolean => {
  const sanitized = StringUtils.removeIllegalCharacters(key)
  if (sanitized === null || sanitized.length === 0) {
    return false
  }
  // Allow real CSS selector syntax used in style-set keys:
  //  - compound selectors: "base-class.modifier", "base-class.modifier .child-class"
  //  - combinators: "card > span", "card + span", "card ~ span", "list *"
  //  - pseudo-selectors / functions: "class:hover", "row:nth-child(2n+1)", "card:not(.active)"
  //  - id selectors: "#main .card"
  //  - attribute selectors: 'input-group input[type="number"]'
  // Attribute-selector brackets can legitimately contain quotes and "=", so they are stripped
  // before the JS-fragment check below. The remaining blacklist still rejects expression/template
  // fragments such as "'coin'", "{{", "||", "${x}" or "a && b".
  const keyWithoutAttributeSelectors = key.replace(/\[[^\]]*\]/g, '')
  // Reject characters that indicate JS expression fragments or are truly invalid CSS selectors.
  // Note: ( ) * + > # are intentionally NOT rejected so pseudo-functions, combinators, the
  // universal selector and id selectors keep working.
  if (/['"{}|!@$%^&=<?/\\]/.test(keyWithoutAttributeSelectors)) {
    return false
  }
  // Reject keys that start with a digit
  if (/^\d/.test(key)) {
    return false
  }
  return true
}

export const resolveStyleSetDefinitions = (
  styleSets: Record<string, UIDLStyleSetDefinition> = {},
  options: GeneratorOptions
): Record<string, UIDLStyleSetDefinition> => {
  return Object.keys(styleSets).reduce((acc: Record<string, UIDLStyleSetDefinition>, styleId) => {
    if (!isValidStyleSetKey(styleId)) {
      return acc
    }
    const styleRef = styleSets[styleId]
    const { conditions = [], content = {} } = styleRef

    if (conditions.length === 0) {
      acc[styleId] = {
        ...styleRef,
        content: prefixAssetURLs(styleRef.content, options?.assets),
      }
      return acc
    }

    const [mediaStyles, elementStates] = conditions.reduce(
      ([media, state]: [UIDLStyleSetMediaCondition[], UIDLStyleSetStateCondition[]], item) => {
        if (item.type === 'screen-size') {
          media.push({
            ...item,
            content: prefixAssetURLs(item.content, options?.assets),
          })
        }
        if (item.type === 'element-state') {
          state.push({
            ...item,
            content: prefixAssetURLs(item.content, options?.assets),
          })
        }
        return [media, state]
      },
      [[], []]
    )

    acc[styleId] = {
      ...styleRef,
      content: prefixAssetURLs(content, options?.assets),
      conditions: [
        ...elementStates,
        ...mediaStyles.sort((a, b) => b.meta.maxWidth - a.meta.maxWidth),
      ],
    }

    return acc
  }, {})
}
