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
  oneOf,
  intersection,
  withDefault,
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
  UIDLElementNodeProjectReferencedStyle,
  VUIDLComponentSEO,
  VUIDLGlobalAsset,
  UIDLExternalDependency,
  UIDLLocalDependency,
  UIDLPeerDependency,
  UIDLImportReference,
  UIDLStyleSetTokenReference,
  VUIDLStyleSetDefnition,
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
  VUIDLStyleSetConditions,
  VUIDLStyleSetMediaCondition,
  VUIDLStyleSetStateCondition,
  VUIDLDesignTokens,
  UIDLPropCallEvent,
  UIDLStateModifierEvent,
  UIDLScriptExternalAsset,
  UIDLScriptInlineAsset,
  VUIDLStyleInlineAsset,
  UIDLStyleExternalAsset,
  VUIDLFontAsset,
  UIDLCanonicalAsset,
  UIDLIconAsset,
  UIDLAssetBase,
  VUIDLElementNodeClassReferencedStyle,
  UIDLCompDynamicReference,
  UIDLComponentStyleReference,
} from '@teleporthq/teleport-types'
import { CustomCombinators } from './custom-combinators'

const { isValidComponentName, isValidFileName, isValidElementName, isValidNavLink } =
  CustomCombinators

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

export const tokenReferenceDecoder: Decoder<UIDLStyleSetTokenReference> = object({
  type: constant('dynamic'),
  content: object({
    referenceType: constant('token'),
    id: string(),
  }),
})

export const styleSetDefinitionDecoder: Decoder<VUIDLStyleSetDefnition> = object({
  type: union(constant('reusable-project-style-map'), constant('reusable-component-style-map')),
  conditions: optional(array(projectStyleConditionsDecoder)),
  content: dict(union(staticValueDecoder, string(), number(), tokenReferenceDecoder)),
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
  componentName: optional(isValidComponentName() as unknown as Decoder<string>),
  navLink: optional(isValidNavLink() as unknown as Decoder<string>),
  fileName: optional(isValidFileName() as unknown as Decoder<string>),
})

export const globalAssetsDecoder: Decoder<VUIDLGlobalAsset> = union(
  lazy(() => inlineScriptAssetDecoder),
  lazy(() => externalScriptAssetDecoder),
  lazy(() => inlineStyletAssetDecoder),
  lazy(() => externalStyleAssetDecoder),
  lazy(() => fontAssetDecoder),
  lazy(() => canonicalAssetDecoder),
  lazy(() => iconAssetDecoder)
)

export const baseAssetDecoder: Decoder<UIDLAssetBase> = object({
  options: optional(
    object({
      async: optional(boolean()),
      defer: optional(boolean()),
      target: optional(string()),
    })
  ),
})

export const inlineScriptAssetDecoder: Decoder<UIDLScriptInlineAsset> = intersection(
  object({
    type: constant('script' as const),
    content: string(),
  }),
  optional(baseAssetDecoder)
)

export const externalScriptAssetDecoder: Decoder<UIDLScriptExternalAsset> = intersection(
  object({
    type: constant('script' as const),
    path: string(),
  }),
  optional(baseAssetDecoder)
)

export const inlineStyletAssetDecoder: Decoder<VUIDLStyleInlineAsset> = object({
  type: constant('style' as const),
  attrs: optional(dict(union(staticValueDecoder, string(), boolean(), number()))),
  content: string(),
})

export const externalStyleAssetDecoder: Decoder<UIDLStyleExternalAsset> = object({
  type: constant('style' as const),
  path: string(),
})

export const fontAssetDecoder: Decoder<VUIDLFontAsset> = object({
  type: constant('font' as const),
  attrs: optional(dict(union(staticValueDecoder, string(), boolean(), number()))),
  path: string(),
})

export const canonicalAssetDecoder: Decoder<UIDLCanonicalAsset> = object({
  type: constant('canonical' as const),
  path: string(),
})

export const iconAssetDecoder: Decoder<UIDLIconAsset> = object({
  type: constant('icon'),
  path: string(),
  options: optional(
    object({
      iconType: optional(string()),
      iconSizes: optional(string()),
    })
  ),
})

export const componentSeoDecoder: Decoder<VUIDLComponentSEO> = object({
  title: optional(string()),
  metaTags: optional(array(dict(string()))),
  assets: optional(array(globalAssetsDecoder)),
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
  defaultValue: stateOrPropDefinitionDecoder,
  values: optional(array(stateValueDetailsDecoder)),
})

export const outputOptionsDecoder: Decoder<UIDLComponentOutputOptions> = object({
  componentClassName: optional(isValidComponentName() as unknown as Decoder<string>),
  fileName: optional(isValidFileName() as unknown as Decoder<string>),
  styleFileName: optional(isValidFileName() as unknown as Decoder<string>),
  templateFileName: optional(isValidFileName() as unknown as Decoder<string>),
  moduleName: optional(isValidFileName() as unknown as Decoder<string>),
  folderPath: optional(array(isValidFileName() as unknown as Decoder<string>)),
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
  importReferenceDecoder,
  lazy(() => uidlComponentStyleReference)
)

export const uidlComponentStyleReference: Decoder<UIDLComponentStyleReference> = object({
  type: constant('comp-style'),
  content: string(),
})

export const styleValueDecoder: Decoder<UIDLStyleValue> = union(
  staticValueDecoder,
  dynamicValueDecoder
)

export const styleDefinitionsDecoder: Decoder<UIDLStyleDefinitions> = dict(styleValueDecoder)

export const eventHandlerStatementDecoder: Decoder<UIDLEventHandlerStatement> = union(
  lazy(() => propCallEventDecoder),
  lazy(() => stateChangeEventDecoder)
)

export const propCallEventDecoder: Decoder<UIDLPropCallEvent> = object({
  type: constant('propCall'),
  calls: string(),
  args: optional(array(union(string(), number(), boolean()))),
})

export const stateChangeEventDecoder: Decoder<UIDLStateModifierEvent> = object({
  type: constant('stateChange'),
  modifies: string(),
  newState: union(string(), number(), boolean()),
})

export const urlLinkNodeDecoder: Decoder<VUIDLURLLinkNode> = object({
  type: constant('url'),
  content: object({
    url: union(attributeValueDecoder, string()),
    newTab: withDefault(false, boolean()),
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

export const elementStateDecoder: Decoder<UIDLElementStyleStates> = oneOf(
  constant('hover'),
  constant('active'),
  constant('focus'),
  constant('focus-within'),
  constant('focus-visible'),
  constant('disabled'),
  constant('visited'),
  constant('checked'),
  constant('link')
)

export const elementStyleWithStateConditionDecoder: Decoder<UIDLStyleStateCondition> = object({
  conditionType: constant('element-state'),
  content: elementStateDecoder,
})

export const elementStyleWithMediaConditionDecoder: Decoder<UIDLStyleMediaQueryScreenSizeCondition> =
  object({
    conditionType: constant('screen-size'),
    minHeight: optional(number()),
    maxHeight: optional(number()),
    minWidth: optional(number()),
    maxWidth: number(),
  })

export const styleConditionsDecoder: Decoder<UIDLStyleConditions> = union(
  elementStyleWithMediaConditionDecoder,
  elementStyleWithStateConditionDecoder
)

export const elementProjectReferencedStyle: Decoder<UIDLElementNodeProjectReferencedStyle> = object(
  {
    type: constant('style-map'),
    content: object({
      mapType: constant('project-referenced'),
      conditions: optional(array(styleConditionsDecoder)),
      referenceId: string(),
    }),
  }
)

export const elementInlineReferencedStyle: Decoder<VUIDLElementNodeInlineReferencedStyle> = object({
  type: constant('style-map'),
  content: object({
    mapType: constant('inlined'),
    conditions: array(styleConditionsDecoder),
    styles: optional(dict(union(attributeValueDecoder, string(), number()))),
  }),
})

export const classDynamicReferenceDecoder: Decoder<UIDLCompDynamicReference> = object({
  type: constant('dynamic'),
  content: object({
    referenceType: union(constant('prop'), constant('comp')),
    id: string(),
  }),
})

export const elementComponentReferencedStyle: Decoder<VUIDLElementNodeClassReferencedStyle> =
  object({
    type: constant('style-map'),
    content: object({
      mapType: constant('component-referenced'),
      content: union(string(), staticValueDecoder, classDynamicReferenceDecoder),
    }),
  })

export const designTokensDecoder: Decoder<VUIDLDesignTokens> = dict(
  union(staticValueDecoder, string(), number())
)

export const elementDecoder: Decoder<VUIDLElement> = object({
  elementType: string(),
  semanticType: optional(string()),
  name: optional(isValidElementName() as unknown as Decoder<string>),
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
    dict(
      union(
        elementInlineReferencedStyle,
        elementProjectReferencedStyle,
        elementComponentReferencedStyle
      )
    )
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
