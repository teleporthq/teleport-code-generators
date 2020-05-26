import {
  object,
  string,
  dict,
  constant,
  number,
  Decoder,
  optional,
  union,
  boolean,
  array,
  lazy,
} from '@mojotech/json-type-validation'

import {
  UIDLStaticValue,
  ReferenceType,
  UIDLDynamicReference,
  UIDLPropDefinition,
  UIDLStateDefinition,
  UIDLStateValueDetails,
  UIDLPageOptions,
  UIDLComponentOutputOptions,
  UIDLDependency,
  UIDLStyleDefinitions,
  UIDLStyleValue,
  UIDLAttributeValue,
  UIDLEventHandlerStatement,
  UIDLURLLinkNode,
  UIDLSectionLinkNode,
  UIDLNavLinkNode,
  UIDLMailLinkNode,
  UIDLPhoneLinkNode,
  UIDLRawValue,
  UIDLElementStyleStates,
  UIDLStyleStateCondition,
  UIDLStyleMediaQueryScreenSizeCondition,
  UIDLStyleConditions,
  UIDLElementNodeProjectReferencedStyle,
  UIDLElementNodeInlineReferencedStyle,
} from '@teleporthq/teleport-types'
import {
  VUIDLStyleSetDefnition,
  VUIDLElement,
  VUIDLSlotNode,
  VUIDLConditionalNode,
  VUIDLRepeatNode,
  VUIDLElementNode,
  VUIDLNode,
} from './types'

export const referenceTypeDecoder: Decoder<ReferenceType> = union(
  constant('prop'),
  constant('state'),
  constant('local'),
  constant('attr'),
  constant('children')
)

export const dynamicValueDecoder: Decoder<UIDLDynamicReference> = object({
  type: constant('dynamic'),
  content: object({
    referenceType: referenceTypeDecoder,
    id: string(),
  }),
})

export const staticValueDecoder: Decoder<UIDLStaticValue> = object({
  type: constant('static'),
  content: union(string(), number(), boolean()),
})

export const styleSetDefinitionDecoder: Decoder<VUIDLStyleSetDefnition> = object({
  id: string(),
  name: string(),
  type: constant('reusable-project-style-map'),
  content: union(dict(staticValueDecoder), dict(string())),
})

// TODO: Implement decoder for () => void
export const stateOrPropDefinitionDecoder = union(
  string(),
  number(),
  boolean(),
  array(union(string(), number(), object())),
  object()
)

export const pageOptionsDecoder: Decoder<UIDLPageOptions> = object({
  componentName: optional(string()),
  navLink: optional(string()),
  fileName: optional(string()),
})

export const stateValueDetailsDecoder: Decoder<UIDLStateValueDetails> = object({
  value: union(string(), number(), boolean()),
  pageoptions: optional(pageOptionsDecoder),
})

export const propDefinitionsDecoder: Decoder<UIDLPropDefinition> = object({
  type: union(
    constant('string'),
    constant('boolean'),
    constant('number'),
    constant('array'),
    constant('func'),
    constant('object'),
    constant('children')
  ),
  defaultValue: optional(stateOrPropDefinitionDecoder),
  isRequired: optional(boolean()),
})

export const stateDefinitionsDecoder: Decoder<UIDLStateDefinition> = object({
  type: union(
    constant('string'),
    constant('boolean'),
    constant('number'),
    constant('array'),
    constant('func'),
    constant('object'),
    constant('children')
  ),
  defaultValue: optional(stateOrPropDefinitionDecoder),
  values: optional(array(stateValueDetailsDecoder)),
})

export const outputOptionsDecoder: Decoder<UIDLComponentOutputOptions> = object({
  componentClassName: optional(string()),
  fileName: optional(string()),
  styleFileName: optional(string()),
  templateFileName: optional(string()),
  moduleName: optional(string()),
  folderPath: optional(array(string())),
})

export const dependencyDecoder: Decoder<UIDLDependency> = object({
  type: union(constant('library'), constant('package'), constant('local')),
  path: string(),
  version: string(),
  meta: object({
    namedImport: boolean(),
    origialName: string(),
  }),
})

export const attributeValueDecoder: Decoder<UIDLAttributeValue> = union(
  dynamicValueDecoder,
  staticValueDecoder
)

export const styleValueDecoder: Decoder<UIDLStyleValue> = attributeValueDecoder

export const styleDefinitionsDecoder: Decoder<UIDLStyleDefinitions> = dict(styleValueDecoder)

export const eventHandlerStatementDecoder: Decoder<UIDLEventHandlerStatement> = object({
  type: string(),
  modifies: string(),
  newState: union(string(), number(), boolean()),
  calls: string(),
  args: array(union(string(), number(), boolean())),
})

export const urlLinkNodeDecoder: Decoder<UIDLURLLinkNode> = object({
  type: constant('url'),
  content: object({
    url: attributeValueDecoder,
    newTab: boolean(),
  }),
})

export const sectionLinkNodeDecoder: Decoder<UIDLSectionLinkNode> = object({
  type: constant('section'),
  content: object({
    section: string(),
  }),
})

export const navLinkNodeDecoder: Decoder<UIDLNavLinkNode> = object({
  type: constant('navlink'),
  content: object({
    routeName: string(),
  }),
})

export const uidlMailLinkNodeDecoder: Decoder<UIDLMailLinkNode> = object({
  type: constant('mail'),
  content: object({
    mail: string(),
    subject: string(),
    body: string(),
  }),
})

export const phoneLinkNodeDecoder: Decoder<UIDLPhoneLinkNode> = object({
  type: constant('phone'),
  content: object({
    phone: string(),
  }),
})

export const uidlLinkNodeDecoder = union(
  urlLinkNodeDecoder,
  sectionLinkNodeDecoder,
  navLinkNodeDecoder,
  uidlMailLinkNodeDecoder,
  phoneLinkNodeDecoder
)

export const rawValueDecoder: Decoder<UIDLRawValue> = object({
  type: constant('raw'),
  content: string(),
})

export const elementStateDecoder: Decoder<UIDLElementStyleStates> = union(
  constant('hover'),
  constant('active'),
  constant('focus'),
  constant('disabled')
)

export const elementStyleWithStateConditionDecoder: Decoder<UIDLStyleStateCondition> = object({
  conditionType: constant('element-state'),
  content: elementStateDecoder,
})

export const elementStyleWithMediaConditionDecoder: Decoder<UIDLStyleMediaQueryScreenSizeCondition> = object(
  {
    conditionType: constant('screen-size'),
    minHeight: optional(number()),
    maxHeight: optional(number()),
    minWidth: optional(number()),
    maxWidth: number(),
  }
)

export const styleConditionsDecoder: Decoder<UIDLStyleConditions> = union(
  elementStyleWithMediaConditionDecoder,
  elementStyleWithStateConditionDecoder
)

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

// TODO: Add suppport for accepting styles, in flat structure under content
export const elementInlineReferencedStyle: Decoder<UIDLElementNodeInlineReferencedStyle> = object({
  id: string(),
  type: constant('style-map'),
  content: object({
    mapType: constant('inlined'),
    conditions: optional(array(styleConditionsDecoder)),
    styles: styleDefinitionsDecoder,
  }),
})

export const element: Decoder<VUIDLElement> = object({
  elementType: string(),
  semanticType: optional(string()),
  name: optional(string()),
  key: optional(string()),
  dependency: optional(dependencyDecoder),
  style: optional(union(styleDefinitionsDecoder, dict(string()))),
  attrributes: optional(dict(attributeValueDecoder)),
  events: optional(dict(array(eventHandlerStatementDecoder))),
  abilities: optional(
    object({
      link: optional(uidlLinkNodeDecoder),
    })
  ),
  children: optional(array(lazy(() => uidlNodeDecoder))),
  referencedStyles: optional(
    dict(union(elementInlineReferencedStyle, elementProjectReferencedStyle))
  ),
  selfClosing: optional(boolean()),
  ignore: optional(boolean()),
})

export const slotNodeDecoder: Decoder<VUIDLSlotNode> = object({
  type: constant('slot'),
  content: object({
    name: string(),
    fallback: optional(union(staticValueDecoder, dynamicValueDecoder)),
  }),
})

export const repeatNodeDecoder: Decoder<VUIDLRepeatNode> = object({
  type: constant('repeat'),
  content: object({
    node: lazy(() => elementNodeDecoder),
    dataSource: attributeValueDecoder,
    meta: optional(
      object({
        useIndex: optional(boolean()),
        iteratorName: optional(string()),
        dataSourceIdentifier: optional(string()),
        iteratorKey: optional(string()),
      })
    ),
  }),
})

export const conditionalNodeDecoder: Decoder<VUIDLConditionalNode> = object({
  type: constant('conditional'),
  content: object({
    node: lazy(() => uidlNodeDecoder),
    reference: dynamicValueDecoder,
    value: union(string(), number(), boolean()),
    condition: optional(
      object({
        conditions: array(
          object({ operation: string(), operand: optional(union(string(), number(), boolean())) })
        ),
        matchingCriteria: optional(string()),
      })
    ),
  }),
})

export const elementNodeDecoder: Decoder<VUIDLElementNode> = object({
  type: constant('element'),
  content: element,
})

const uidlNodeDecoder: Decoder<VUIDLNode> = union(
  elementNodeDecoder,
  dynamicValueDecoder,
  staticValueDecoder,
  rawValueDecoder,
  conditionalNodeDecoder,
  repeatNodeDecoder,
  slotNodeDecoder,
  string()
)
