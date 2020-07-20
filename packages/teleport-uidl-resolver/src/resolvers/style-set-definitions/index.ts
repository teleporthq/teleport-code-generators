/* 
    Styleset-Definitions have conditions which helps in applying media styles
    and pseudo styles on them. These need to be sorted as we do for referenced-Styles
*/

import {
  ComponentUIDL,
  UIDLStyleSetDefinition,
  UIDLStyleSetMediaCondition,
} from '@teleporthq/teleport-types'

export const resolveStyleSetDefinitions = (input: ComponentUIDL) => {
  if (!input?.styleSetDefinitions) {
    return
  }
  input.styleSetDefinitions = sortStyleSetDefinitions(input.styleSetDefinitions)
}

const sortStyleSetDefinitions = (styleSets: Record<string, UIDLStyleSetDefinition>) => {
  return Object.values(styleSets).reduce(
    (acc: Record<string, UIDLStyleSetDefinition>, styleRef) => {
      const { conditions = [] } = styleRef

      if (conditions.length === 0) {
        return (acc = {
          ...acc,
          [styleRef.id]: {
            ...styleRef,
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
        },
      })
    },
    {}
  )
}
