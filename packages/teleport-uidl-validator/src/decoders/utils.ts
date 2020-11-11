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
  UIDLNavLinkNode,
  UIDLMailLinkNode,
  UIDLPhoneLinkNode,
  UIDLRawValue,
  UIDLElementStyleStates,
  UIDLStyleStateCondition,
  UIDLStyleMediaQueryScreenSizeCondition,
  UIDLStyleConditions,
  UIDLComponentSEO,
  UIDLGlobalAsset,
  UIDLExternalDependency,
  UIDLLocalDependency,
  UIDLPeerDependency,
  UIDLImportReference,
  UIDLStyleSetTokenReference,
  VUIDLElement,
  VUIDLSlotNode,
  VUIDLConditionalNode,
  VUIDLRepeatNode,
  VUIDLElementNode,
  VUIDLNode,
  VUIDLElementNodeInlineReferencedStyle,
  VUIDLSectionLinkNode,
  VUIDLLinkNode,
  VUIDLURLLinkNode,
  VUIDLDesignTokens,
} from '@teleporthq/teleport-types'
import { CustomCombinators } from './custom-combinators'
import { elementProjectReferencedStyle } from './project-style-sheet-decoders'

const {
  isValidComponentName,
  isValidFileName,
  isValidElementName,
  isValidNavLink,
} = CustomCombinators

export const referenceTypeDecoder: Decoder<ReferenceType> = union(
  constant('prop'),
  constant('state'),
  constant('local'),
  constant('attr'),
  constant('children'),
  constant('token')
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
  content: union(string(), number(), boolean(), array()),
})

export const tokenReferenceDecoder: Decoder<UIDLStyleSetTokenReference> = object({
  type: constant('dynamic'),
  content: object({
    referenceType: constant('token'),
    id: string(),
  }),
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
  componentName: optional((isValidComponentName() as unknown) as Decoder<string>),
  navLink: optional((isValidNavLink() as unknown) as Decoder<string>),
  fileName: optional((isValidFileName() as unknown) as Decoder<string>),
})

export const globalAssetsValidator: Decoder<UIDLGlobalAsset> = object({
  type: union(
    constant('script'),
    constant('style'),
    constant('font'),
    constant('canonical'),
    constant('icon')
  ),
  path: optional(string()),
  content: optional(string()),
  options: optional(
    object({
      async: optional(boolean()),
      defer: optional(boolean()),
      target: optional(string()),
      iconType: optional(string()),
      iconSizes: optional(string()),
    })
  ),
})

export const componentSeoDecoder: Decoder<UIDLComponentSEO> = object({
  title: optional(string()),
  metaTags: optional(array(dict(string()))),
  assets: optional(array(globalAssetsValidator)),
})

export const stateValueDetailsDecoder: Decoder<UIDLStateValueDetails> = object({
  value: union(string(), number(), boolean()),
  pageOptions: optional(pageOptionsDecoder),
  seo: optional(componentSeoDecoder),
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
  defaultValue: stateOrPropDefinitionDecoder,
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
  defaultValue: stateOrPropDefinitionDecoder,
  values: optional(array(stateValueDetailsDecoder)),
})

export const outputOptionsDecoder: Decoder<UIDLComponentOutputOptions> = object({
  componentClassName: optional((isValidComponentName() as unknown) as Decoder<string>),
  fileName: optional((isValidFileName() as unknown) as Decoder<string>),
  styleFileName: optional((isValidFileName() as unknown) as Decoder<string>),
  templateFileName: optional((isValidFileName() as unknown) as Decoder<string>),
  moduleName: optional((isValidFileName() as unknown) as Decoder<string>),
  folderPath: optional(array((isValidFileName() as unknown) as Decoder<string>)),
})

export const peerDependencyDecoder: Decoder<UIDLPeerDependency> = object({
  type: constant('package'),
  version: string(),
  path: string(),
})

export const externaldependencyDecoder: Decoder<UIDLExternalDependency> = object({
  type: union(constant('library'), constant('package')),
  path: string(),
  version: string(),
  meta: optional(
    object({
      namedImport: optional(boolean()),
      originalName: optional(string()),
      importJustPath: optional(boolean()),
      useAsReference: optional(boolean()),
    })
  ),
})

export const localDependencyDecoder: Decoder<UIDLLocalDependency> = object({
  type: constant('local'),
  path: optional(string()),
  meta: optional(
    object({
      namedImport: optional(boolean()),
      originalName: optional(string()),
      importJustPath: optional(boolean()),
    })
  ),
})

export const dependencyDecoder: Decoder<UIDLDependency> = union(
  localDependencyDecoder,
  externaldependencyDecoder
)

export const importReferenceDecoder: Decoder<UIDLImportReference> = object({
  type: constant('import'),
  content: object({
    id: string(),
  }),
})

export const attributeValueDecoder: Decoder<UIDLAttributeValue> = union(
  dynamicValueDecoder,
  staticValueDecoder,
  importReferenceDecoder
)

export const styleValueDecoder: Decoder<UIDLStyleValue> = union(
  staticValueDecoder,
  dynamicValueDecoder
)

export const styleDefinitionsDecoder: Decoder<UIDLStyleDefinitions> = dict(styleValueDecoder)

export const eventHandlerStatementDecoder: Decoder<UIDLEventHandlerStatement> = object({
  type: string(),
  calls: optional(string()),
  modifies: optional(string()),
  newState: optional(union(string(), number(), boolean())),
  args: optional(array(union(string(), number(), boolean()))),
})

export const urlLinkNodeDecoder: Decoder<VUIDLURLLinkNode> = object({
  type: constant('url'),
  content: object({
    url: union(attributeValueDecoder, string()),
    newTab: boolean(),
  }),
})

export const sectionLinkNodeDecoder: Decoder<VUIDLSectionLinkNode> = object({
  type: constant('section'),
  content: dict(string()),
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
    mail: optional(string()),
    subject: optional(string()),
    body: optional(string()),
  }),
})

export const phoneLinkNodeDecoder: Decoder<UIDLPhoneLinkNode> = object({
  type: constant('phone'),
  content: object({
    phone: string(),
  }),
})

export const uidlLinkNodeDecoder: Decoder<VUIDLLinkNode> = union(
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

export const elementInlineReferencedStyle: Decoder<VUIDLElementNodeInlineReferencedStyle> = object({
  id: string(),
  type: constant('style-map'),
  content: object({
    mapType: constant('inlined'),
    conditions: array(styleConditionsDecoder),
    styles: optional(dict(union(attributeValueDecoder, string(), number()))),
  }),
})

export const designTokensDecoder: Decoder<VUIDLDesignTokens> = dict(
  union(staticValueDecoder, string(), number())
)

export const elementDecoder: Decoder<VUIDLElement> = object({
  elementType: string(),
  semanticType: optional(string()),
  name: optional((isValidElementName() as unknown) as Decoder<string>),
  key: optional(string()),
  dependency: optional(dependencyDecoder),
  style: optional(dict(union(attributeValueDecoder, string(), number()))),
  attrs: optional(dict(union(attributeValueDecoder, string(), number()))),
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
  content: union(
    object({
      name: optional(string()),
      fallback: optional(
        union(
          staticValueDecoder,
          dynamicValueDecoder,
          lazy(() => elementNodeDecoder)
        )
      ),
    }),
    object({})
  ),
})

export const repeatNodeDecoder: Decoder<VUIDLRepeatNode> = object({
  type: constant('repeat'),
  content: object({
    node: lazy(() => elementNodeDecoder),
    dataSource: optional(attributeValueDecoder),
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
  content: elementDecoder,
})

export const uidlNodeDecoder: Decoder<VUIDLNode> = union(
  elementNodeDecoder,
  dynamicValueDecoder,
  staticValueDecoder,
  rawValueDecoder,
  conditionalNodeDecoder,
  repeatNodeDecoder,
  slotNodeDecoder,
  string()
)
