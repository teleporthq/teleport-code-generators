/* 
    Styleset-Definitions have conditions which helps in applying media styles
    and pseudo styles on them. These need to be sorted as we do for referenced-Styles
*/

import { UIDLStyleSetDefinition, UIDLStyleSetMediaCondition } from '@teleporthq/teleport-types'

export const resolveStyleSetDefinitions = (
  styleSets: Record<string, UIDLStyleSetDefinition>
): Record<string, UIDLStyleSetDefinition> => {
  return Object.keys(styleSets).reduce((acc: Record<string, UIDLStyleSetDefinition>, styleId) => {
    const styleRef = styleSets[styleId]
    const { conditions = [] } = styleRef

    if (conditions.length === 0) {
      acc[styleId] = styleRef
      return acc
    }

    const mediaConditions = conditions
      .filter((item): item is UIDLStyleSetMediaCondition => item.type === 'screen-size')
      .sort(
        (a: UIDLStyleSetMediaCondition, b: UIDLStyleSetMediaCondition) =>
          b.meta.maxWidth - a.meta.maxWidth
      )
    const elementStateConditions = conditions.filter((item) => item.type === 'element-state')

    acc[styleId] = {
      ...styleRef,
      conditions: [...elementStateConditions, ...mediaConditions],
    }

    return acc
  }, {})
}
