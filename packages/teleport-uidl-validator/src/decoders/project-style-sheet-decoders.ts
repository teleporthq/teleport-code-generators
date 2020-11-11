import {
  object,
  string,
  dict,
  constant,
  number,
  Decoder,
  optional,
  union,
  array,
  lazy,
} from '@mojotech/json-type-validation'
import {
  VUIDLStyleSetDefnition,
  VUIDLStyleSetConditions,
  VUIDLStyleSetMediaCondition,
  VUIDLStyleSetStateCondition,
  UIDLElementNodeProjectReferencedStyle,
} from '@teleporthq/teleport-types'
import {
  staticValueDecoder,
  tokenReferenceDecoder,
  elementStateDecoder,
  styleConditionsDecoder,
} from './utils'

export const elementProjectReferencedStyle: Decoder<UIDLElementNodeProjectReferencedStyle> = object(
  {
    id: string(),
    type: constant('style-map'),
    content: object({
      mapType: constant('project-referenced'),
      conditions: optional(array(styleConditionsDecoder)),
      referenceId: string(),
    }),
  }
)

export const styleSetMediaConditionDecoder: Decoder<VUIDLStyleSetMediaCondition> = object({
  type: constant('screen-size'),
  meta: object({
    maxWidth: number(),
    maxHeight: optional(number()),
    minHeight: optional(number()),
    minWidth: optional(number()),
  }),
  content: dict(
    union(
      staticValueDecoder,
      string(),
      number(),
      lazy(() => tokenReferenceDecoder)
    )
  ),
})

export const styleSetStateConditionDecoder: Decoder<VUIDLStyleSetStateCondition> = object({
  type: constant('element-state'),
  meta: object({
    state: lazy(() => elementStateDecoder),
  }),
  content: dict(
    union(
      staticValueDecoder,
      string(),
      number(),
      lazy(() => tokenReferenceDecoder)
    )
  ),
})

export const projectStyleConditionsDecoder: Decoder<VUIDLStyleSetConditions> = union(
  styleSetMediaConditionDecoder,
  styleSetStateConditionDecoder
)

export const styleSetDefinitionDecoder: Decoder<VUIDLStyleSetDefnition> = object({
  id: string(),
  name: string(),
  type: constant('reusable-project-style-map'),
  conditions: optional(array(projectStyleConditionsDecoder)),
  content: dict(union(staticValueDecoder, string(), number(), tokenReferenceDecoder)),
})
