/* 
    Styleset-Definitions have conditions which helps in applying media styles
    and pseudo styles on them. These need to be sorted as we do for referenced-Styles
*/

import { StringUtils } from '@teleporthq/teleport-shared'
import { UIDLStyleSetDefinition, UIDLStyleSetMediaCondition } from '@teleporthq/teleport-types'

export const resolveStyleSetDefinitions = (
  styleSets: Record<string, UIDLStyleSetDefinition>
): Record<string, UIDLStyleSetDefinition> => {
  return Object.values(styleSets).reduce(
    (acc: Record<string, UIDLStyleSetDefinition>, styleRef) => {
      const { conditions = [] } = styleRef

      if (conditions.length === 0) {
        return (acc = {
          ...acc,
          [styleRef.id]: {
            ...styleRef,
            name: StringUtils.dashCaseToCamelCase(styleRef.name),
          },
        })
      }

      const mediaConditions = conditions
        .filter((item) => item.type === 'screen-size')
        .sort(
          (a: UIDLStyleSetMediaCondition, b: UIDLStyleSetMediaCondition) =>
            a.meta.maxWidth - b.meta.maxWidth
        )
        .reverse()
      const elementStateConditions = conditions.filter((item) => item.type === 'element-state')

      return (acc = {
        ...acc,
        [styleRef.id]: {
          ...styleRef,
          conditions: [...elementStateConditions, ...mediaConditions],
          name: StringUtils.dashCaseToCamelCase(styleRef.name),
        },
      })
    },
    {}
  )
}
