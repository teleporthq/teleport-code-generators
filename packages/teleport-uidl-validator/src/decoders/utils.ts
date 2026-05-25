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
  succeed,
} from '@mojotech/json-type-validation'
import {
  UIDLStaticValue,
  ReferenceType,
  UIDLDynamicReference,
  UIDLStateDefinition,
  UIDLPageOptions,
  UIDLDetailsPageInfo,
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
  UIDLDynamicCondition,
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
  union(constant('expr'), constant('locale'), constant('ctx'))
)

export const globalValueDecoder: Decoder<UIDLGlobalReference> = object({
  type: constant('dynamic'),
  content: object({
    referenceType: constant('global'),
    // id is optional to support Shape B refs where the first refPath segment
    // encodes the context root (e.g. refPath: ["E-commerce", "Cart", "total"]).
    // The generator normalizes these to id="ecommerce" at code-gen time.
    id: optional(
      union(
        constant('locale'),
        constant('locales'),
        constant('currentUser'),
        constant('userIsLoggedIn'),
        constant('ecommerce'),
        constant('cart'),
        string()
      )
    ),
    refPath: optional(array(string())),
  }),
}) as Decoder<UIDLGlobalReference>

export const globalStateValueDecoder: Decoder<UIDLDynamicReference> = object({
  type: constant('dynamic'),
  content: object({
    referenceType: constant('globalState' as any),
    id: string(),
    refPath: optional(array(string())),
  }),
}) as Decoder<UIDLDynamicReference>

export const dynamicValueDecoder: Decoder<UIDLDynamicReference> = union(
  object({
    type: constant('dynamic'),
    content: object({
      referenceType: referenceTypeDecoder,
      refPath: optional(array(string())),
      id: optional(string()),
      fallback: optional(union(string(), number(), boolean())),
      valueMapper: optional(string()),
    }),
  }),
  globalValueDecoder,
  globalStateValueDecoder
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
  dynamic: optional(dynamicValueDecoder),
  fallback: optional(string()),
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
  pageId: optional(string()),
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
    union(constant('element'), constant('link'))
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

export const dataSourceBindingDecoder = object({
  dataSourceId: string(),
  refPath: array(union(string(), number())),
})

// Binds a state definition's initial value to a page-level URL search param.
// At runtime the generator emits `useState(router?.query?.<key> ?? defaultValue)`
// so the state hydrates from the URL on navigation — e.g. a deep link like
// `/admin/products?products_detail_panel_item_id=<id>` auto-opens the matching
// detail panel. The decoder MUST list this field explicitly; the json-type
// `object(...)` decoder is strict and silently drops any unrecognised keys,
// which previously nulled out this binding during schema validation and left
// the generated hook as a plain `useState('')`.
export const urlSearchParamBindingDecoder = object({
  key: string(),
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
  id: optional(string()),
  dataSourceBinding: optional(dataSourceBindingDecoder),
  urlSearchParamBinding: optional(urlSearchParamBindingDecoder),
  query: optional(string()),
  mappingFunction: optional(string()),
  sortConfig: optional(anyJson()),
  filterConfig: optional(anyJson()),
})

export const detailsPageInfoDecoder: Decoder<UIDLDetailsPageInfo> = object({
  dataSourceId: string(),
  dataSourceName: string(),
  dataSourceType: string(),
  tableName: string(),
  differentiatorColumn: string(),
  featureIdentifier: string(),
})

export const pageOptionsDecoder: Decoder<UIDLPageOptions> = object({
  componentName: optional(string().andThen(isValidComponentName)),
  navLink: optional(string().andThen(isValidNavLink)),
  fileName: optional(string().andThen(isValidFileName)),
  fallback: optional(boolean()),
  dynamicRouteAttribute: optional(string()),
  lastmod: optional(string()),
  pagination: optional(pageOptionsPaginationDecoder),
  initialPropsData: optional(initialPropsDecoder),
  initialPathsData: optional(initialPathsDecoder),
  detailsPageInfo: optional(detailsPageInfoDecoder),
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
  dynamicRouteAttribute: optional(string()),
  pagination: optional(pageOptionsPaginationDecoder),
  initialPropsData: optional(initialPropsDecoder),
  initialPathsData: optional(initialPathsDecoder),
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
  includeEventObject: optional(boolean()),
})

export const stateChangeEventDecoder: Decoder<UIDLStateModifierEvent> = object({
  type: constant('stateChange'),
  modifies: string(),
  newState: union(string(), number(), boolean(), dynamicValueDecoder, expressionValueDecoder),
  includeEventObject: optional(boolean()),
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
    differentiatorValue: optional(
      union(dynamicValueDecoder, staticValueDecoder, expressionValueDecoder)
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

export const conditionalProjectStyleDecoder: Decoder<UIDLDynamicCondition> = object({
  reference: dynamicValueDecoder,
  importDefinitions: optional(dict(externaldependencyDecoder)),
  value: optional(union(string(), number(), boolean())),
  expression: optional(
    object({
      conditions: array(
        object({
          operation: string(),
          operand: optional(
            union(string(), number(), boolean(), dynamicValueDecoder, expressionValueDecoder)
          ),
        })
      ),
      matchingCriteria: optional(string()),
    })
  ),
})

export const elementProjectReferencedStyle: Decoder<UIDLElementNodeProjectReferencedStyle> = object(
  {
    type: constant('style-map'),
    content: object({
      mapType: constant('project-referenced'),
      conditions: optional(array(styleConditionsDecoder)),
      referenceId: string(),
      condition: optional(conditionalProjectStyleDecoder),
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

// Helper decoder that handles both UIDLNode format and plain element format in children arrays
const flexibleChildDecoder: Decoder<VUIDLNode> = lazy(() => {
  return anyJson().andThen((json: any) => {
    // If it has "elementType" but no "type", wrap it in a UIDLNode
    if (json && typeof json === 'object' && json.elementType && !json.type) {
      // Return a decoder that succeeds with the wrapped node
      return succeed({
        type: 'element' as const,
        content: json,
      } as VUIDLNode)
    }
    // Otherwise, try parsing as a normal UIDLNode
    return uidlNodeDecoder
  })
})

export const conditionalExpressionDecoder = object({
  conditions: array(
    object({
      operation: string(),
      operand: optional(
        union(string(), number(), boolean(), dynamicValueDecoder, expressionValueDecoder)
      ),
    })
  ),
  matchingCriteria: optional(string()),
})

export const renderingConditionsDecoder = object({
  reference: union(dynamicValueDecoder, expressionValueDecoder),
  condition: conditionalExpressionDecoder,
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
  children: withDefault([], array(flexibleChildDecoder)),
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
  dynamicStyleBindings: optional(
    dict(
      object({
        referenceType: oneOf(constant('state'), constant('ctx')),
        stateKey: string(),
        defaultValue: string(),
        contextName: optional(string()),
        stateDefinitionId: optional(string()),
      })
    )
  ),
  renderingConditions: optional(renderingConditionsDecoder),
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
          object({
            operation: string(),
            operand: optional(
              union(string(), number(), boolean(), dynamicValueDecoder, expressionValueDecoder)
            ),
          })
        ),
        matchingCriteria: optional(string()),
      })
    ),
  }),
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
      loading: optional(lazy(() => elementNodeDecoder)),
    }),
    dependency: optional(lazy(() => dependencyDecoder)),
    source: optional(string()),
    renderPropIdentifier: string(),
    paginated: optional(boolean()),
    perPage: optional(number()),
    searchEnabled: optional(boolean()),
    searchDebounce: optional(number()),
    sort: optional(union(staticValueDecoder, expressionValueDecoder)),
    sortDirection: optional(union(staticValueDecoder, expressionValueDecoder)),
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

// Data source content that can be wrapped in an element node
// This matches the hybrid structure: { type: "data-source-item", content: {...}, children: [] }
const dataSourceItemContentDecoder = object({
  type: constant('data-source-item'),
  content: object({
    elementType: string(),
    name: optional(string()),
    key: optional(string()),
    attrs: optional(dict(union(attributeValueDecoder, string(), number()))),
    renderPropIdentifier: string(),
    dependency: optional(dependencyDecoder),
    nodes: object({
      success: lazy(() => elementNodeDecoder),
      error: optional(lazy(() => elementNodeDecoder)),
      loading: optional(lazy(() => elementNodeDecoder)),
    }),
    valuePath: optional(array(string())),
    resourceDefinition: object({
      type: string(),
      dataSourceId: string(),
      tableName: optional(string()),
      dataSourceType: string(),
    }),
    resource: optional(uidlResourceLinkDecoder),
    initialData: optional(anyJson()),
  }),
  children: withDefault([], array(lazy(() => uidlNodeDecoder))),
  // Element properties at the hybrid level
  name: withDefault('data-source-item', string()),
  key: optional(string()),
  elementType: optional(string()),
  semanticType: optional(string()),
  style: optional(dict(union(styleValueDecoder, string(), number()))),
  attrs: optional(dict(union(attributeValueDecoder, string(), number()))),
  events: withDefault({}, dict(array(eventHandlerStatementDecoder))),
  abilities: optional(object({ link: optional(anyJson()) })),
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
  dependency: optional(dependencyDecoder),
})

const dataSourceListContentDecoder = object({
  type: constant('data-source-list'),
  content: object({
    elementType: string(),
    name: optional(string()),
    key: optional(string()),
    attrs: optional(dict(union(attributeValueDecoder, string(), number()))),
    renderPropIdentifier: string(),
    dependency: optional(dependencyDecoder),
    nodes: object({
      success: lazy(() => elementNodeDecoder),
      error: optional(lazy(() => elementNodeDecoder)),
      loading: optional(lazy(() => elementNodeDecoder)),
    }),
    valuePath: optional(array(string())),
    resourceDefinition: object({
      type: string(),
      dataSourceId: string(),
      tableName: optional(string()),
      dataSourceType: string(),
    }),
    resource: optional(uidlResourceLinkDecoder),
    initialData: optional(anyJson()),
  }),
  children: withDefault([], array(lazy(() => uidlNodeDecoder))),
  // Element properties at the hybrid level
  name: withDefault('data-source-list', string()),
  key: optional(string()),
  elementType: optional(string()),
  semanticType: optional(string()),
  style: optional(dict(union(styleValueDecoder, string(), number()))),
  attrs: optional(dict(union(attributeValueDecoder, string(), number()))),
  events: withDefault({}, dict(array(eventHandlerStatementDecoder))),
  abilities: optional(object({ link: optional(anyJson()) })),
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
  dependency: optional(dependencyDecoder),
})

export const dataSourceItemNodeDecoder: Decoder<any> = object({
  type: constant('data-source-item'),
  content: object({
    elementType: string(),
    name: optional(string()),
    key: optional(string()),
    attrs: optional(dict(union(attributeValueDecoder, string(), number()))),
    renderPropIdentifier: string(),
    dependency: optional(dependencyDecoder),
    nodes: object({
      success: lazy(() => elementNodeDecoder),
      error: optional(lazy(() => elementNodeDecoder)),
      loading: optional(lazy(() => elementNodeDecoder)),
    }),
    valuePath: optional(array(string())),
    resourceDefinition: object({
      type: string(),
      dataSourceId: string(),
      tableName: optional(string()),
      dataSourceType: string(),
    }),
    resource: optional(uidlResourceLinkDecoder),
    initialData: optional(anyJson()),
  }),
})

export const dataSourceListNodeDecoder: Decoder<any> = object({
  type: constant('data-source-list'),
  content: object({
    elementType: string(),
    name: optional(string()),
    key: optional(string()),
    attrs: optional(dict(union(attributeValueDecoder, string(), number()))),
    renderPropIdentifier: string(),
    dependency: optional(dependencyDecoder),
    nodes: object({
      success: lazy(() => elementNodeDecoder),
      error: optional(lazy(() => elementNodeDecoder)),
      loading: optional(lazy(() => elementNodeDecoder)),
    }),
    valuePath: optional(array(string())),
    resourceDefinition: object({
      type: string(),
      dataSourceId: string(),
      tableName: optional(string()),
      dataSourceType: string(),
    }),
    resource: optional(uidlResourceLinkDecoder),
    initialData: optional(anyJson()),
  }),
})

// Element node decoder that can wrap standard elements or data-source hybrid structures
export const elementNodeDecoder: Decoder<VUIDLElementNode> = object({
  type: constant('element'),
  content: union(elementDecoder, dataSourceItemContentDecoder, dataSourceListContentDecoder),
}) as any

export const uidlNodeDecoder: Decoder<VUIDLNode> = union(
  union(elementNodeDecoder, dynamicValueDecoder, rawValueDecoder, conditionalNodeDecoder),
  union(staticValueDecoder, repeatNodeDecoder, slotNodeDecoder, expressionValueDecoder, string()),
  union(
    cmsItemNodeDecoder,
    cmsListNodeDecoder,
    cmsListRepeaterNodeDecoder,
    cmsMixedTypeNodeDecoder
  ),
  union(dataSourceItemNodeDecoder, dataSourceListNodeDecoder)
)

export const formFieldValidationDecoder = object({
  pattern: optional(staticValueDecoder),
  minLength: optional(staticValueDecoder),
  maxLength: optional(staticValueDecoder),
  min: optional(staticValueDecoder),
  max: optional(staticValueDecoder),
  customValidation: optional(expressionValueDecoder),
})

export const formFieldDecoder = object({
  id: staticValueDecoder,
  name: staticValueDecoder,
  nodeId: staticValueDecoder,
  type: oneOf(
    constant('textinput'),
    constant('textarea'),
    constant('select'),
    constant('checkbox'),
    constant('radiobutton'),
    constant('button')
  ),
  required: optional(staticValueDecoder),
  validation: optional(formFieldValidationDecoder),
})

export const formBehaviorDecoder = object({
  action: oneOf(
    constant('message'),
    constant('redirect-page'),
    constant('redirect-url'),
    constant('clear-form'),
    constant('clear-form-and-alert')
  ),
  details: optional(
    object({
      pageId: optional(staticValueDecoder),
      url: optional(staticValueDecoder),
      message: optional(
        union(
          staticValueDecoder,
          object({
            type: constant('component-ref'),
            componentId: staticValueDecoder,
          })
        )
      ),
    })
  ),
})

export const formDefinitionDecoder = object({
  id: staticValueDecoder,
  name: staticValueDecoder,
  formNodeId: staticValueDecoder,
  context: optional(
    object({
      type: oneOf(constant('page'), constant('component')),
      id: staticValueDecoder,
    })
  ),
  fields: dict(formFieldDecoder),
  behaviors: object({
    onSuccess: formBehaviorDecoder,
    onError: formBehaviorDecoder,
    onLimit: optional(formBehaviorDecoder),
  }),
  notifications: optional(
    object({
      sendToSubscriber: staticValueDecoder,
      sendToEmails: array(staticValueDecoder),
    })
  ),
  security: optional(
    object({
      captchaPublicKey: optional(union(staticValueDecoder, envValueDecoder)),
      honeypotField: optional(staticValueDecoder),
    })
  ),
  constraints: optional(
    object({
      expirationDate: optional(staticValueDecoder),
      submissionsLimit: optional(staticValueDecoder),
    })
  ),
  messages: optional(
    object({
      success: optional(staticValueDecoder),
      error: optional(staticValueDecoder),
      limit: optional(staticValueDecoder),
    })
  ),
  meta: optional(
    object({
      createdAt: staticValueDecoder,
      updatedAt: staticValueDecoder,
    })
  ),
})

export const formsDecoder = object({
  items: dict(formDefinitionDecoder),
  globalConfig: optional(
    object({
      captchaProvider: optional(
        oneOf(constant('recaptcha'), constant('hcaptcha'), constant('turnstile'))
      ),
      emailServiceRef: optional(string()),
      defaultCaptchaPublicKey: optional(union(staticValueDecoder, envValueDecoder)),
    })
  ),
  formsServerUrl: optional(union(staticValueDecoder, envValueDecoder)),
})

// Data Sources decoder - allows any configuration structure
export const dataSourceDecoder = object({
  id: string(),
  name: string(),
  type: string(),
  config: dict(unknownJson()),
})

export const dataSourcesDecoder = dict(dataSourceDecoder)
