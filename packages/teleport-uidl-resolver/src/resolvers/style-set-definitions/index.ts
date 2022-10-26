/* 
    Styleset-Definitions have conditions which helps in applying media styles
    and pseudo styles on them. These need to be sorted as we do for referenced-Styles
*/

import {
  GeneratorOptions,
  UIDLStyleSetDefinition,
  UIDLStyleSetMediaCondition,
  UIDLStyleSetStateCondition,
} from '@teleporthq/teleport-types'
import { prefixAssetURLs } from '../../utils'

export const resolveStyleSetDefinitions = (
  styleSets: Record<string, UIDLStyleSetDefinition> = {},
  options: GeneratorOptions
): Record<string, UIDLStyleSetDefinition> => {
  return Object.keys(styleSets).reduce((acc: Record<string, UIDLStyleSetDefinition>, styleId) => {
    const styleRef = styleSets[styleId]
    const { conditions = [] } = styleRef

    if (conditions.length === 0) {
      acc[styleId] = {
        ...styleRef,
        content: prefixAssetURLs(styleRef.content, options?.assetsPrefix || ''),
      }
      return acc
    }

    const [mediaStyles, elementStates] = conditions.reduce(
      ([media, state]: [UIDLStyleSetMediaCondition[], UIDLStyleSetStateCondition[]], item) => {
        if (item.type === 'screen-size') {
          media.push({
            ...item,
            content: prefixAssetURLs(item.content, options?.assetsPrefix || ''),
          })
        }
        if (item.type === 'element-state') {
          state.push({
            ...item,
            content: prefixAssetURLs(item.content, options?.assetsPrefix || ''),
          })
        }
        return [media, state]
      },
      [[], []]
    )

    acc[styleId] = {
      ...styleRef,
      conditions: [
        ...elementStates,
        ...mediaStyles.sort((a, b) => b.meta.maxWidth - a.meta.maxWidth),
      ],
    }

    return acc
  }, {})
}
