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
  // Allow compound CSS selectors like "base-class.modifier" or "base-class.modifier .child-class"
  // These are valid CSS and used for state-dependent styling (e.g., dashboard-sidebar.collapsed)
  // Also allow pseudo-selectors like "class:hover" and "class:focus-within"
  // Reject characters that indicate JS expression fragments or are truly invalid
  if (/['"{}|()!@#$%^&*+=<>?/\\]/.test(key)) {
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
