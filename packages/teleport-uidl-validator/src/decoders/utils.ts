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
  anyJson,
  unknownJson,
} from '@mojotech/json-type-validation'
import {
  UIDLStaticValue,
  ReferenceType,
  UIDLDynamicReference,
  UIDLStateDefinition,
  UIDLPageOptions,
  UIDLComponentOutputOptions,
  UIDLDependency,
  UIDLStyleDefinitions,
  UIDLStyleValue,
  VUIDLAttributeValue,
  UIDLEventHandlerStatement,
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
  PagePaginationOptions,
  VCMSItemUIDLElementNode,
  VCMSListUIDLElementNode,
  UIDLInitialPathsData,
  UIDLInitialPropsData,
  UIDLExpressionValue,
  UIDLDynamicLinkNode,
  UIDLENVValue,
  UIDLPropValue,
  UIDLResourceItem,
  VUIDLNavLinkNode,
  VUIDLDateTimeNode,
  UIDLStateValue,
  UIDLResourceLink,
  UIDLLocalResource,
  UIDLExternalResource,
  VCMSListRepeaterElementNode,
  UIDLResourceMapper,
  UIDLInjectValue,
  VUIDLStateValueDetails,
  VUIDLCMSMixedTypeNode,
  UIDLLocalFontAsset,
  VUIDLPropDefinitions,
  UIDLGlobalReference,
  UIDLObjectValue,
} from '@teleporthq/teleport-types'
import {
  isValidElementName,
  isValidNavLink,
  isValidFileName,
  isValidComponentName,
} from './custom-combinators'

export const referenceTypeDecoder: Decoder<ReferenceType> = union(
  constant('prop'),
  constant('state'),
  constant('local'),
  constant('attr'),
  constant('children'),
  constant('token'),
  constant('expr'),
  constant('locale')
)

export const globalValueDecoder: Decoder<UIDLGlobalReference> = object({
  type: constant('dynamic'),
  content: object({
    referenceType: constant('global'),
    id: union(constant('locale'), constant('locales')),
    refPath: optional(array(string())),
  }),
})

export const dynamicValueDecoder: Decoder<UIDLDynamicReference> = union(
  object({
    type: constant('dynamic'),
    content: object({
      referenceType: referenceTypeDecoder,
      refPath: optional(array(string())),
      id: string(),
    }),
  }),
  globalValueDecoder
)

export const expressionValueDecoder: Decoder<UIDLExpressionValue> = object({
  type: constant('expr'),
  content: string(),
})

export const staticValueDecoder: Decoder<UIDLStaticValue> = object({
  type: constant('static'),
  content: union(string(), number(), boolean(), array(), object()),
})

export const rawValueDecoder: Decoder<UIDLRawValue> = object({
  type: constant('raw'),
  content: string(),
})

export const envValueDecoder: Decoder<UIDLENVValue> = object({
  type: constant('env'),
  content: string(),
})

export const dyamicFunctionParam: Decoder<UIDLPropValue> = object({
  type: constant('dynamic'),
  content: object({
    referenceType: constant('prop'),
    id: string(),
  }),
})

export const dyamicFunctionStateParam: Decoder<UIDLStateValue> = object({
  type: constant('dynamic'),
  content: object({
    referenceType: constant('state'),
    id: string(),
  }),
})

export const resourceItemDecoder: Decoder<UIDLResourceItem> = object({
  name: string(),
  headers: optional(dict(union(staticValueDecoder, envValueDecoder))),
  path: object({
    baseUrl: union(staticValueDecoder, envValueDecoder),
    route: staticValueDecoder,
  }),
  method: withDefault('GET', union(constant('GET'), constant('POST'))),
  body: optional(dict(union(staticValueDecoder, expressionValueDecoder))),
  mappers: withDefault([], array(string())),
  params: optional(
    dict(
      union(
        staticValueDecoder,
        dyamicFunctionParam,
        dyamicFunctionStateParam,
        expressionValueDecoder
      )
    )
  ),
  response: optional(
    object({
      type: withDefault(
        'json',
        union(constant('json'), constant('headers'), constant('text'), constant('none'))
      ),
    })
  ),
})

export const initialPropsDecoder: Decoder<UIDLInitialPropsData> = object({
  exposeAs: object({
    name: string(),
    valuePath: withDefault([], array(string())),
  }),
  resource: union(
    object({
      id: string(),
      params: optional(dict(union(staticValueDecoder, expressionValueDecoder))),
    }),
    object({
      name: string(),
      dependency: lazy(() => externaldependencyDecoder),
      params: optional(dict(union(staticValueDecoder, expressionValueDecoder))),
    })
  ),
  cache: optional(object({ revalidate: number() })),
})

export const initialPathsDecoder: Decoder<UIDLInitialPathsData> = object({
  exposeAs: object({
    name: string(),
    valuePath: optional(array(string())),
    itemValuePath: optional(array(string())),
  }),
  resource: union(
    object({
      id: string(),
      params: optional(dict(union(staticValueDecoder, expressionValueDecoder))),
    }),
    object({
      name: string(),
      dependency: lazy(() => externaldependencyDecoder),
      params: optional(dict(union(staticValueDecoder, expressionValueDecoder))),
    })
  ),
})

export const injectValueDecoder: Decoder<UIDLInjectValue> = object({
  type: constant('inject'),
  content: string(),
  dependency: optional(lazy(() => externaldependencyDecoder)),
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
  type: union(
    constant('reusable-project-style-map'),
    constant('reusable-component-style-map'),
    constant('reusable-component-style-override')
  ),
  conditions: optional(array(projectStyleConditionsDecoder)),
  content: dict(union(staticValueDecoder, string(), number(), tokenReferenceDecoder)),
  className: optional(string()),
  subselectors: optional(string()),
})

export const stateDefinitionsDefaultValueDecoder = union(
  string(),
  number(),
  boolean(),
  array(union(string(), number(), object())),
  object()
)

export const globalAssetsDecoder: Decoder<VUIDLGlobalAsset> = union(
  lazy(() => inlineScriptAssetDecoder),
  lazy(() => externalScriptAssetDecoder),
  lazy(() => inlineStyletAssetDecoder),
  lazy(() => externalStyleAssetDecoder),
  lazy(() => fontAssetDecoder),
  lazy(() => canonicalAssetDecoder),
  lazy(() => iconAssetDecoder),
  lazy(() => localFontDecoder)
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

export const localFontDecoder: Decoder<UIDLLocalFontAsset> = object({
  type: constant('local-font' as const),
  path: string(),
  properties: dict(staticValueDecoder),
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
  title: optional(union(string(), staticValueDecoder, dynamicValueDecoder)),
  metaTags: optional(array(dict(union(string(), staticValueDecoder, dynamicValueDecoder)))),
  assets: optional(array(globalAssetsDecoder)),
})

export const stateValueDetailsDecoder: Decoder<VUIDLStateValueDetails> = object({
  value: union(string(), number(), boolean()),
  pageOptions: optional(lazy(() => pageOptionsDecoder)),
  seo: optional(componentSeoDecoder),
})

export const propDefinitionsDecoder: Decoder<VUIDLPropDefinitions> = object({
  type: union(
    constant('string'),
    constant('boolean'),
    constant('number'),
    constant('array'),
    constant('func'),
    constant('object'),
    constant('children'),
    constant('element')
  ),
  defaultValue: optional(
    union(
      stateDefinitionsDefaultValueDecoder,
      lazy(() => elementNodeDecoder)
    )
  ),
  isRequired: optional(boolean()),
  id: optional(string()),
})

export const pageOptionsPaginationDecoder: Decoder<PagePaginationOptions> = object({
  attribute: string(),
  pageSize: number(),
  totalCountPath: object({
    type: union(constant('headers'), constant('body')),
    path: array(union(string(), number())),
  }),
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
  defaultValue: stateDefinitionsDefaultValueDecoder,
})

export const pageOptionsDecoder: Decoder<UIDLPageOptions> = object({
  componentName: optional(string().andThen(isValidComponentName)),
  navLink: optional(string().andThen(isValidNavLink)),
  fileName: optional(string().andThen(isValidFileName)),
  fallback: optional(boolean()),
  pagination: optional(pageOptionsPaginationDecoder),
  initialPropsData: optional(initialPropsDecoder),
  initialPathsData: optional(initialPathsDecoder),
  propDefinitions: optional(dict(propDefinitionsDecoder)),
  stateDefinitions: optional(dict(stateDefinitionsDecoder)),
})

export const outputOptionsDecoder: Decoder<UIDLComponentOutputOptions> = object({
  componentClassName: optional(string().andThen(isValidComponentName)),
  fileName: optional(string().andThen(isValidFileName)),
  styleFileName: optional(string().andThen(isValidFileName)),
  templateFileName: optional(string().andThen(isValidFileName)),
  moduleName: optional(string().andThen(isValidFileName)),
  folderPath: optional(array(string().andThen(isValidFileName))),
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
      importAlias: optional(string()),
      needsWindowObject: optional(boolean()),
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
      importAlias: optional(string()),
    })
  ),
})

export const dependencyDecoder: Decoder<UIDLDependency> = union(
  localDependencyDecoder,
  externaldependencyDecoder
)

export const resourceMapperDecoder: Decoder<UIDLResourceMapper> = object({
  params: array(string()),
  dependency: dependencyDecoder,
})

export const importReferenceDecoder: Decoder<UIDLImportReference> = object({
  type: constant('import'),
  content: object({
    id: string(),
  }),
})

export const attributeValueDecoder: Decoder<VUIDLAttributeValue> = union(
  dynamicValueDecoder,
  staticValueDecoder,
  lazy(() => expressionValueDecoder),
  importReferenceDecoder,
  rawValueDecoder,
  lazy(() => uidlComponentStyleReference),
  lazy(() => elementNodeDecoder),
  lazy(() => objectValueDecoder)
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
    url: union(
      expressionValueDecoder,
      dynamicValueDecoder,
      staticValueDecoder,
      importReferenceDecoder,
      uidlComponentStyleReference,
      rawValueDecoder,
      string()
    ),
    newTab: withDefault(false, boolean()),
  }),
})

export const dynamicLinkDecoder: Decoder<UIDLDynamicLinkNode> = object({
  type: constant('dynamic'),
  content: object({
    referenceType: referenceTypeDecoder,
    path: optional(array(string())),
    id: string(),
  }),
})

export const sectionLinkNodeDecoder: Decoder<VUIDLSectionLinkNode> = object({
  type: constant('section'),
  content: object({
    section: union(string(), staticValueDecoder, expressionValueDecoder),
  }),
})

export const navLinkNodeDecoder: Decoder<VUIDLNavLinkNode> = object({
  type: constant('navlink'),
  content: object({
    routeName: union(
      expressionValueDecoder,
      dynamicValueDecoder,
      staticValueDecoder,
      importReferenceDecoder,
      uidlComponentStyleReference,
      rawValueDecoder,
      string()
    ),
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
  phoneLinkNodeDecoder,
  dynamicLinkDecoder
)

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
    styles: optional(dict(union(styleValueDecoder, string(), number()))),
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

export const objectValueDecoder: Decoder<UIDLObjectValue> = object({
  type: constant('object'),
  content: unknownJson(),
})

export const elementDecoder: Decoder<VUIDLElement> = object({
  elementType: string(),
  semanticType: optional(string()),
  name: optional(string().andThen(isValidElementName)),
  key: optional(string()),
  dependency: optional(dependencyDecoder),
  style: optional(dict(union(styleValueDecoder, string(), number()))),
  attrs: optional(dict(union(attributeValueDecoder, string(), number()))),
  events: withDefault({}, dict(array(eventHandlerStatementDecoder))),
  abilities: optional(
    object({
      link: optional(anyJson()),
    })
  ),
  children: withDefault([], array(lazy(() => uidlNodeDecoder))),
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
    dataSource: optional(
      union(
        expressionValueDecoder,
        dynamicValueDecoder,
        staticValueDecoder,
        importReferenceDecoder,
        uidlComponentStyleReference,
        rawValueDecoder
      )
    ),
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
    reference: union(dynamicValueDecoder, expressionValueDecoder),
    importDefinitions: optional(dict(externaldependencyDecoder)),
    value: optional(union(string(), number(), boolean())),
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

export const dateTimeNodeDecoder: Decoder<VUIDLDateTimeNode> = object({
  type: constant('date-time-node'),
  content: elementDecoder,
})

export const uidlLocalResourcerDecpder: Decoder<UIDLLocalResource> = object({
  id: string(),
  params: optional(
    dict(
      union(
        staticValueDecoder,
        dyamicFunctionParam,
        expressionValueDecoder,
        lazy(() => dyamicFunctionStateParam)
      )
    )
  ),
})

export const uidlExternalResourceDecoder: Decoder<UIDLExternalResource> = object({
  name: string(),
  dependency: lazy(() => externaldependencyDecoder),
  params: optional(
    dict(
      union(
        staticValueDecoder,
        dyamicFunctionParam,
        expressionValueDecoder,
        lazy(() => dyamicFunctionStateParam)
      )
    )
  ),
})

export const uidlResourceLinkDecoder: Decoder<UIDLResourceLink> = union(
  uidlLocalResourcerDecpder,
  uidlExternalResourceDecoder
)

export const cmsItemNodeDecoder: Decoder<VCMSItemUIDLElementNode> = object({
  type: constant('cms-item'),
  content: object({
    elementType: string(),
    name: withDefault('cms-item', string()),
    attrs: optional(dict(union(attributeValueDecoder, string(), number()))),
    nodes: object({
      success: lazy(() => elementNodeDecoder),
      error: optional(lazy(() => elementNodeDecoder)),
      loading: optional(lazy(() => elementNodeDecoder)),
    }),
    router: optional(lazy(() => dependencyDecoder)),
    dependency: optional(lazy(() => dependencyDecoder)),
    renderPropIdentifier: string(),
    valuePath: withDefault([], array(string())),
    itemValuePath: optional(array(string())),
    resource: optional(uidlResourceLinkDecoder),
    initialData: optional(lazy(() => dyamicFunctionParam)),
    entityKeyProperty: optional(string()),
  }),
})

export const cmsListNodeDecoder: Decoder<VCMSListUIDLElementNode> = object({
  type: constant('cms-list'),
  content: object({
    elementType: string(),
    name: withDefault('cms-list', string()),
    attrs: optional(dict(union(attributeValueDecoder, string(), number()))),
    nodes: object({
      success: lazy(() => elementNodeDecoder),
      error: optional(lazy(() => elementNodeDecoder)),
      loading: optional(lazy(() => elementNodeDecoder)),
      empty: optional(lazy(() => elementNodeDecoder)),
    }),
    router: optional(lazy(() => dependencyDecoder)),
    dependency: optional(lazy(() => dependencyDecoder)),
    renderPropIdentifier: string(),
    itemValuePath: optional(array(string())),
    valuePath: withDefault([], array(string())),
    resource: optional(uidlResourceLinkDecoder),
    initialData: optional(lazy(() => dyamicFunctionParam)),
  }),
})

export const cmsListRepeaterNodeDecoder: Decoder<VCMSListRepeaterElementNode> = object({
  type: constant('cms-list-repeater'),
  content: object({
    elementType: string(),
    name: withDefault('cms-list-repeater', string()),
    nodes: object({
      list: lazy(() => elementNodeDecoder),
      empty: optional(lazy(() => elementNodeDecoder)),
    }),
    dependency: optional(lazy(() => dependencyDecoder)),
    source: optional(string()),
    renderPropIdentifier: string(),
  }),
})

export const cmsMixedTypeNodeDecoder: Decoder<VUIDLCMSMixedTypeNode> = object({
  type: constant('cms-mixed-type'),
  content: object({
    elementType: string(),
    name: withDefault('cms-mixed-type', string()),
    attrs: withDefault(
      {},
      lazy(() => dict(union(attributeValueDecoder, string(), number())))
    ),
    renderPropIdentifier: string(),
    nodes: object({
      fallback: optional(lazy(() => elementNodeDecoder)),
      error: optional(lazy(() => elementNodeDecoder)),
    }),
    dependency: optional(lazy(() => dependencyDecoder)),
    mappings: withDefault({}, dict(lazy(() => elementNodeDecoder))),
  }),
})

export const uidlNodeDecoder: Decoder<VUIDLNode> = union(
  union(elementNodeDecoder, dynamicValueDecoder, rawValueDecoder, conditionalNodeDecoder),
  union(staticValueDecoder, repeatNodeDecoder, slotNodeDecoder, expressionValueDecoder, string()),
  union(cmsItemNodeDecoder, cmsListNodeDecoder, cmsListRepeaterNodeDecoder, cmsMixedTypeNodeDecoder)
)
