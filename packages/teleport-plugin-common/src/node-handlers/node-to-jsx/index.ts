import * as types from '@babel/types'
import {
  UIDLElementNode,
  UIDLRepeatNode,
  UIDLConditionalNode,
  UIDLConditionalExpression,
  UIDLDynamicReference,
  UIDLSlotNode,
  UIDLNode,
  UIDLCMSListNode,
  UIDLCMSItemNode,
  UIDLExpressionValue,
  UIDLCMSListRepeaterNode,
  UIDLCMSMixedTypeNode,
  UIDLElement,
  UIDLDataSourceItemNode,
  UIDLDataSourceListNode,
  UIDLRawValue,
  UIDLDependency,
} from '@teleporthq/teleport-types'
import { UIDLUtils, StringUtils } from '@teleporthq/teleport-shared'
import { JSXASTReturnType, JSXGenerationOptions, JSXGenerationParams, NodeToJSX } from './types'

import {
  addEventHandlerToTag,
  createConditionIdentifier,
  createDynamicValueExpression,
  createConditionalJSXExpression,
  getRepeatSourceIdentifier,
  resolveGlobalStateName,
  createGlobalStateExpression,
  resolveAndRegisterGlobalStateSource,
} from './utils'
import {
  addChildJSXText,
  addChildJSXTag,
  addAttributeToJSXTag,
  addDynamicAttributeToJSXTag,
  addRawAttributeToJSXTag,
  generateDynamicWindowImport,
  addDynamicExpressionAttributeToJSXTag,
  resolveObjectValue,
  objectToObjectExpression,
  parseStringWithTemplateExpressions,
  parseJSExpressionAsAST,
  convertToReactAttributeName,
  GLOBAL_REF_ID_MAP,
  sanitizeExprContent,
} from '../../utils/ast-utils'
import { createJSXTag, createSelfClosingJSXTag } from '../../builders/ast-builders'
import { DEFAULT_JSX_OPTIONS } from './constants'
import { ASTBuilders, ASTUtils } from '../..'

// Global references in the UIDL come in two shapes:
// Shape A: { id: "ecommerce", refPath: ["Cart", "total"] }
// Shape B: { id: undefined, refPath: ["E-commerce", "Settings", "Delivery", "..."] }
// This helper normalizes Shape B into Shape A so downstream code can handle
// both uniformly. The first refPath segment is mapped to a variable name via
// GLOBAL_REF_ID_MAP (exported from ast-utils so all sites stay in sync).
// Expression attributes (UIDLExpressionValue) bypass the dynamic-reference
// tracking in createDynamicValueExpression. When such an expression mentions
// a known global (currentUser/ecommerce/cart/locale/userIsLoggedIn) we still
// Plan v15 Layer 4 — junk-name attribute guard.
// AI fabrication artefacts emit attributes whose KEY is a JS literal
// (`true="true"`, `false="false"`, `0="x"`, `null="..."`). They survive JSX
// parsing (treated as string-valued attrs) but break DOM semantics. The
// upstream Layer 1–3 pipeline should already strip them; this is the final
// codegen safety net.
const CODEGEN_JUNK_ATTR_NAMES: ReadonlySet<string> = new Set(['true', 'false', 'null', 'undefined'])

function isJunkAttributeName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0) {
    return true
  }
  const lower = name.toLowerCase()
  if (CODEGEN_JUNK_ATTR_NAMES.has(lower)) {
    return true
  }
  if (/^[0-9]+$/.test(name)) {
    return true
  }
  return false
}

function hasCorruptBindingMarkers(value: string): boolean {
  // Entity-escaped `{` / `}` from upstream serialization that should never
  // reach the JSX output verbatim.
  if (/&#123;|&#125;/.test(value)) {
    return true
  }
  // Unbalanced `{{` (no matching `}}`).
  const opens = (value.match(/\{\{/g) || []).length
  const closes = (value.match(/\}\}/g) || []).length
  if (opens > closes) {
    return true
  }
  return false
}

function truncate(value: string): string {
  if (value.length <= 60) {
    return value
  }
  return value.slice(0, 57) + '...'
}

// need to push it into params.globalReferences so downstream plugins inject
// the corresponding `useGlobalContext()` destructuring.
const GLOBAL_EXPRESSION_IDENTIFIERS: Array<{ pattern: RegExp; id: string }> = [
  { pattern: /\bcurrentUser\b/, id: 'currentUser' },
  { pattern: /\buserIsLoggedIn\b/, id: 'userIsLoggedIn' },
  { pattern: /\becommerce\b/, id: 'ecommerce' },
  { pattern: /\bcart\b/, id: 'cart' },
  { pattern: /\blocales?\b/, id: 'locale' },
]

const trackGlobalRefsInExpression = (expression: string, params: JSXGenerationParams): void => {
  if (!expression) {
    return
  }
  for (const { pattern, id } of GLOBAL_EXPRESSION_IDENTIFIERS) {
    if (pattern.test(expression)) {
      params.globalReferences.push(id as Parameters<typeof params.globalReferences.push>[0])
    }
  }

  // Global-state identifiers behave the same way: an expression-shaped UIDL
  // attribute (e.g. cms-mixed-type `itemData`) bypasses the dynamic-ref
  // pipeline that registers `useGlobalState()` destructuring, so we walk the
  // raw expression text and re-attach any state name we recognise. The
  // matched names are added to `globalStateReferences` and the
  // next-global-state component plugin destructures them at codegen time.
  const definitions = params.globalStateDefinitions
  if (!definitions || Object.keys(definitions).length === 0) {
    return
  }
  for (const def of Object.values(definitions)) {
    const name = def?.name
    if (!name) {
      continue
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\b`).test(expression)) {
      params.globalStateReferences.push({ id: def.id, name })
    }
  }
}

const normalizeGlobalRef = <
  T extends { content: { id: string; refPath?: string[]; referenceType: string } }
>(
  node: T
): T => {
  if (node.content.id || !node.content.refPath || node.content.refPath.length === 0) {
    return node
  }
  const firstSeg = node.content.refPath[0]
  const mappedId = GLOBAL_REF_ID_MAP[firstSeg]
  if (!mappedId) {
    return node
  }
  return {
    ...node,
    content: { ...node.content, id: mappedId, refPath: node.content.refPath.slice(1) },
  }
}

const getElementType = (node: UIDLNode): string | null => {
  if (
    node.type === 'element' &&
    node.content &&
    typeof node.content === 'object' &&
    'elementType' in node.content
  ) {
    return (node.content as any).elementType
  }
  if ((node.type === 'data-source-list' || node.type === 'data-source-item') && node.content) {
    return (node.content as any).elementType || 'DataProvider'
  }
  return null
}

const getClassName = (node: UIDLNode): string | null => {
  if (
    node.type === 'element' &&
    node.content &&
    typeof node.content === 'object' &&
    'key' in node.content
  ) {
    return (node.content as any).key || null
  }
  return null
}

const REACT_CHARTJS2_CHART_TAGS = new Set([
  'Line',
  'Bar',
  'Doughnut',
  'Pie',
  'Radar',
  'Bubble',
  'PolarArea',
  'Scatter',
])

const isReactChartjs2Chart = (
  dependency: UIDLDependency | undefined,
  elementType: string
): boolean => {
  if (dependency?.path !== 'react-chartjs-2') {
    return false
  }
  return REACT_CHARTJS2_CHART_TAGS.has(elementType)
}

/**
 * Chart.js with maintainAspectRatio:false fills the parent; if height is on the chart
 * component via className, react-chartjs-2 may not apply it to the canvas host correctly
 * inside flex layouts, causing unbounded growth. Wrap in a bounded div and move className
 * to the wrapper; the chart fills with height/width 100%.
 */
const wrapReactChartJs2Element = (
  chartElement: types.JSXElement,
  _node: UIDLElementNode
): types.JSXElement => {
  const attrs = chartElement.openingElement.attributes
  const kept: typeof attrs = []
  let classNameAttr: types.JSXAttribute | null = null
  for (const a of attrs) {
    if (
      a.type === 'JSXAttribute' &&
      a.name.type === 'JSXIdentifier' &&
      a.name.name === 'className'
    ) {
      classNameAttr = a
    } else {
      kept.push(a)
    }
  }
  chartElement.openingElement.attributes = kept
  const hasStyleAttr = kept.some(
    (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'style'
  )
  if (!hasStyleAttr) {
    chartElement.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('style'),
        types.jsxExpressionContainer(
          types.objectExpression([
            types.objectProperty(types.identifier('height'), types.stringLiteral('100%')),
            types.objectProperty(types.identifier('width'), types.stringLiteral('100%')),
          ])
        )
      )
    )
  }

  const wrapperStyle = types.objectExpression([
    types.objectProperty(types.identifier('position'), types.stringLiteral('relative')),
    types.objectProperty(types.identifier('minHeight'), types.numericLiteral(0)),
    types.objectProperty(types.identifier('flexShrink'), types.numericLiteral(0)),
    types.objectProperty(types.identifier('overflow'), types.stringLiteral('hidden')),
  ])

  const wrapperAttrs: types.JSXAttribute[] = [
    types.jsxAttribute(types.jsxIdentifier('style'), types.jsxExpressionContainer(wrapperStyle)),
  ]
  if (classNameAttr) {
    wrapperAttrs.push(classNameAttr)
  }

  return types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier('div'), wrapperAttrs),
    types.jsxClosingElement(types.jsxIdentifier('div')),
    [chartElement],
    false
  )
}

const isCalendarKitScheduler = (
  dependency: UIDLDependency | undefined,
  elementType: string
): boolean => {
  return dependency?.path === 'calendarkit-basic' && elementType === 'BasicScheduler'
}

/**
 * calendarkit-basic's BasicScheduler requires `start`/`end` to be Date objects
 * (date-fns internals), but UIDL attrs carry them as ISO strings — both for
 * static event arrays and for state-bound arrays populated by workflows.
 * Rewrites `events={X}` into:
 *   events={(Array.isArray(X) ? X : []).map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) }))}
 * The Array.isArray guard renders zero events instead of crashing when a
 * binding resolves to a non-array (e.g. an unparsed JSON-string fallback).
 * A missing `events` attr is left as-is — the component defaults it to [].
 */
const wrapCalendarKitEventsAttr = (calendarElement: types.JSXElement): void => {
  const attr = calendarElement.openingElement.attributes.find(
    (a): a is types.JSXAttribute =>
      a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'events'
  )

  if (!attr || attr.value?.type !== 'JSXExpressionContainer') {
    return
  }
  const source = attr.value.expression
  if (!types.isExpression(source)) {
    return
  }

  // A static array literal needs no runtime guard; dynamic references do.
  const guardedSource = types.isArrayExpression(source)
    ? source
    : types.conditionalExpression(
        types.callExpression(
          types.memberExpression(types.identifier('Array'), types.identifier('isArray')),
          [source]
        ),
        types.cloneNode(source),
        types.arrayExpression([])
      )

  const reviveEvent = types.arrowFunctionExpression(
    [types.identifier('e')],
    types.objectExpression([
      types.spreadElement(types.identifier('e')),
      types.objectProperty(
        types.identifier('start'),
        types.newExpression(types.identifier('Date'), [
          types.memberExpression(types.identifier('e'), types.identifier('start')),
        ])
      ),
      types.objectProperty(
        types.identifier('end'),
        types.newExpression(types.identifier('Date'), [
          types.memberExpression(types.identifier('e'), types.identifier('end')),
        ])
      ),
    ])
  )

  attr.value = types.jsxExpressionContainer(
    types.callExpression(types.memberExpression(guardedSource, types.identifier('map')), [
      reviveEvent,
    ])
  )
}

const reorderChildrenForSearch = (children: UIDLNode[]): UIDLNode[] => {
  const searchNodes: UIDLNode[] = []
  const dataProviderNodes: UIDLNode[] = []
  const paginationNodes: UIDLNode[] = []
  const otherNodes: UIDLNode[] = []

  children.forEach((child) => {
    const elementType = getElementType(child)
    const nodeType = child.type
    const className = getClassName(child)

    // Check for search nodes - use className since elementType is replaced by semanticType
    if (
      className &&
      (className.includes('data-source-search') || className.includes('search-node'))
    ) {
      searchNodes.push(child)
    }
    // Check for DataProvider nodes - these should appear SECOND
    else if (
      nodeType === 'data-source-list' ||
      nodeType === 'data-source-item' ||
      elementType === 'DataProvider'
    ) {
      dataProviderNodes.push(child)
    }
    // Check for pagination nodes - use className since elementType is replaced by semanticType
    else if (
      (elementType &&
        (elementType.includes('pagination') || elementType.includes('cms-pagination'))) ||
      (className && (className.includes('pagination') || className.includes('cms-pagination')))
    ) {
      paginationNodes.push(child)
    }
    // Everything else goes in the middle
    else {
      otherNodes.push(child)
    }
  })

  // Only reorder if we have search or pagination nodes alongside a DataProvider
  // This ensures we only reorder when there's an actual pagination/search group
  // If there's no search/pagination, keep original order to preserve DataProvider positions
  const hasSearchOrPagination = searchNodes.length > 0 || paginationNodes.length > 0
  const hasDataProvider = dataProviderNodes.length > 0

  if (hasSearchOrPagination && hasDataProvider) {
    // Order: search nodes first, then data providers, then other nodes, then pagination last
    // This ensures: search input -> DataProvider -> content -> pagination buttons
    return [...searchNodes, ...dataProviderNodes, ...otherNodes, ...paginationNodes]
  } else {
    // No reordering needed - preserve original order
    return children
  }
}

/**
 * Extracts autocomplete context from a thq-autocomplete node's children.
 * Returns the input's field name and the dropdown's isOpen state name,
 * so child option/clear elements can wire up onClick handlers.
 */
const extractAutocompleteContext = (
  children: UIDLNode[],
  formStateName?: string
): JSXGenerationParams['autocompleteContext'] => {
  let fieldName: string | null = null
  let inputHtmlId: string | null = null
  let isOpenStateName: string | null = null

  for (const child of children) {
    if (child.type === 'element') {
      const content = child.content as UIDLElement
      // Check both original elementType and data-thq attr (elementType may have been resolved)
      const dataThq = content.attrs?.['data-thq']
      const thqValue = dataThq?.type === 'static' ? String(dataThq.content) : ''
      if (
        content.elementType === 'thq-autocomplete-input' ||
        thqValue === 'thq-autocomplete-input'
      ) {
        const nameAttr = content.attrs?.name
        if (nameAttr?.type === 'static' && typeof nameAttr.content === 'string') {
          fieldName = nameAttr.content
        }
        const idAttr = content.attrs?.id
        if (idAttr?.type === 'static' && typeof idAttr.content === 'string') {
          inputHtmlId = idAttr.content
        }
      }
    } else if (child.type === 'conditional') {
      const condContent = child.content as UIDLConditionalNode['content']
      const ref = (condContent as any).reference?.content
      if (ref?.referenceType === 'state' && typeof ref.id === 'string') {
        isOpenStateName = ref.id
      }
    }
  }

  if (fieldName && isOpenStateName) {
    return { fieldName, inputHtmlId: inputHtmlId || '', formStateName, isOpenStateName }
  }
  return undefined
}

const maybeAddFormStoreFieldBinding = (
  elementTag: types.JSXElement,
  elementName: string,
  attrs: UIDLElement['attrs'] | undefined,
  params: JSXGenerationParams,
  events?: UIDLElement['events']
) => {
  const stateKey = params.formStoreStateName
  if (!stateKey || !attrs) {
    return
  }

  const nameAttr = attrs.name
  if (!nameAttr || nameAttr.type !== 'static' || typeof nameAttr.content !== 'string') {
    return
  }

  const tag = elementName.toLowerCase()
  const isRichTextEditor = tag === 'richtexteditor'
  if (tag !== 'input' && tag !== 'textarea' && tag !== 'select' && !isRichTextEditor) {
    return
  }

  // Autocomplete inputs manage their own value through workflows and option onClick handlers.
  // Do NOT bind them to the form store — it causes infinite loops with state-change workflows.
  const dataThq = attrs['data-thq']
  if (dataThq?.type === 'static' && String(dataThq.content) === 'thq-autocomplete-input') {
    return
  }

  const fieldName = nameAttr.content
  const stateId = types.identifier(stateKey)
  const fieldAccess = types.memberExpression(stateId, types.stringLiteral(fieldName), true)

  const typeAttr = attrs.type
  const isCheckbox = typeAttr?.type === 'static' && String(typeAttr.content) === 'checkbox'

  const hasValueInAttrs = Object.prototype.hasOwnProperty.call(attrs, 'value')
  const hasCheckedInAttrs = Object.prototype.hasOwnProperty.call(attrs, 'checked')

  if (isRichTextEditor) {
    const valueForEditor = types.logicalExpression('||', fieldAccess, types.stringLiteral(''))
    elementTag.openingElement.attributes.push(
      types.jsxAttribute(types.jsxIdentifier('value'), types.jsxExpressionContainer(valueForEditor))
    )
    const setterName = `set${stateKey.charAt(0).toUpperCase()}${stateKey.slice(1)}`
    const richHandler = parseJSExpressionAsAST(
      `(html) => { ${setterName}(prev => ({ ...prev, ['${fieldName}']: html })); }`
    )
    elementTag.openingElement.attributes.push(
      types.jsxAttribute(types.jsxIdentifier('onChange'), types.jsxExpressionContainer(richHandler))
    )
    return
  }

  if (!hasValueInAttrs && !isCheckbox) {
    const valueExpr = types.logicalExpression('??', fieldAccess, types.stringLiteral(''))
    elementTag.openingElement.attributes.push(
      types.jsxAttribute(types.jsxIdentifier('value'), types.jsxExpressionContainer(valueExpr))
    )
  } else if (isCheckbox && !hasCheckedInAttrs) {
    elementTag.openingElement.attributes.push(
      types.jsxAttribute(types.jsxIdentifier('checked'), types.jsxExpressionContainer(fieldAccess))
    )
  }

  const hasUidlOnChange = events && Object.prototype.hasOwnProperty.call(events, 'onChange')
  if (!hasUidlOnChange) {
    const setterName = `set${stateKey.charAt(0).toUpperCase()}${stateKey.slice(1)}`
    const handler = parseJSExpressionAsAST(
      `(e) => { const t = e.target; if (t.name) { ${setterName}(prev => ({ ...prev, [t.name]: t.type === 'checkbox' ? t.checked : t.value })); } }`
    )
    elementTag.openingElement.attributes.push(
      types.jsxAttribute(types.jsxIdentifier('onChange'), types.jsxExpressionContainer(handler))
    )
  }
}

const generateElementNode: NodeToJSX<UIDLElementNode, types.JSXElement> = (
  node,
  params,
  jsxOptions
) => {
  const { dependencies, nodesLookup } = params
  const options = { ...DEFAULT_JSX_OPTIONS, ...jsxOptions }
  const { elementType, selfClosing, children, key, attrs, dependency, events } = node.content

  const originalElementName = elementType || 'component'
  let tagName = originalElementName

  // Check if this is a fragment element - normalize to Fragment before processing
  const isFragment = tagName.toLowerCase() === 'fragment'
  if (isFragment) {
    tagName = 'Fragment'
  }

  if (dependency) {
    if (
      options.dependencyHandling === 'import' ||
      (options.dependencyHandling === 'ignore' && dependency?.type === 'package')
    ) {
      const existingDependency = dependencies[tagName]
      if (existingDependency && existingDependency?.path !== dependency?.path) {
        tagName = `${StringUtils.dashCaseToUpperCamelCase(
          StringUtils.removeIllegalCharacters(dependency.path)
        )}${tagName}`
        dependencies[tagName] = {
          ...dependency,
          meta: {
            ...dependency.meta,
            originalName: originalElementName,
          },
        }
      } else {
        // Make a copy to avoid reference leaking
        dependencies[tagName] = { ...dependency }
      }
    }

    if (dependency?.meta && `needsWindowObject` in dependency.meta) {
      const dynamicWindowImport = generateDynamicWindowImport('useEffect', dependency.path)
      params.windowImports[dependency.path] = dynamicWindowImport
    }
  } else if (isFragment) {
    // If no dependency was provided but this is a fragment, add Fragment dependency
    if (options.dependencyHandling === 'import') {
      dependencies.Fragment = {
        type: 'package',
        path: 'react',
        version: 'latest',
        meta: {
          namedImport: true,
        },
      }
    }
  }

  const elementName =
    dependency && dependency.type === 'local' && options.customElementTag
      ? options.customElementTag(tagName)
      : tagName

  const elementTag = selfClosing ? createSelfClosingJSXTag(elementName) : createJSXTag(elementName)

  if (attrs) {
    addAttributesToJSXTag(
      attrs,
      elementTag,
      options,
      params,
      node.content.semanticType || elementType
    )
  }

  if (events) {
    Object.keys(events).forEach((eventKey) => {
      addEventHandlerToTag(elementTag, eventKey, events[eventKey], params, options)
    })
  }

  // Generate onChange handler for form elements with data-store-values-state
  let childParams = params
  if (attrs?.['data-store-values-state']) {
    const storeAttr = attrs['data-store-values-state']
    if (storeAttr.type === 'static' && typeof storeAttr.content === 'string') {
      const stateName = storeAttr.content
      childParams = { ...params, formStoreStateName: stateName }
      const setterName = `set${stateName.charAt(0).toUpperCase()}${stateName.slice(1)}`
      const handler = parseJSExpressionAsAST(
        `(e) => { const t = e.target; if (t.name && t.getAttribute('data-thq') !== 'thq-autocomplete-input') { ${setterName}(prev => ({ ...prev, [t.name]: t.type === 'checkbox' ? t.checked : t.value })); } }`
      )
      elementTag.openingElement.attributes.push(
        types.jsxAttribute(types.jsxIdentifier('onChange'), types.jsxExpressionContainer(handler))
      )
    }
  }

  maybeAddFormStoreFieldBinding(elementTag, elementName, attrs, childParams, events)

  // thq-autocomplete-input: make uncontrolled by converting `value` → `defaultValue`
  // A controlled autocomplete input triggers state-change workflows on every keystroke,
  // which normalizes the typed text and prevents free typing for search/filtering.
  const dataThqAttr = attrs?.['data-thq']
  const dataThqValue = dataThqAttr?.type === 'static' ? String(dataThqAttr.content) : ''

  if (dataThqValue === 'thq-autocomplete-input') {
    const jsxAttrs = elementTag.openingElement.attributes
    const valueIdx = jsxAttrs.findIndex(
      (a) => a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'value'
    )
    if (valueIdx !== -1) {
      // Convert value → defaultValue so the input is uncontrolled but has initial value
      const valueAttr = jsxAttrs[valueIdx] as types.JSXAttribute
      jsxAttrs.splice(
        valueIdx,
        1,
        types.jsxAttribute(types.jsxIdentifier('defaultValue'), valueAttr.value)
      )
    }
  }

  if (dataThqValue === 'thq-autocomplete' && children) {
    const acCtx = extractAutocompleteContext(children, childParams.formStoreStateName)
    if (acCtx) {
      childParams = { ...childParams, autocompleteContext: acCtx }
    }
  }

  // thq-autocomplete-option: add onClick to select the option value
  if (dataThqValue === 'thq-autocomplete-option' && params.autocompleteContext) {
    const { fieldName, formStateName, isOpenStateName, inputHtmlId } = params.autocompleteContext
    const isOpenSetterName = `set${isOpenStateName.charAt(0).toUpperCase()}${isOpenStateName.slice(
      1
    )}`

    let handlerCode: string
    // The autocomplete input is uncontrolled, so always set the DOM value.
    // If form-store mode, also update the form state for form submission.
    const inputLookup = inputHtmlId
      ? `document.getElementById('${inputHtmlId}')`
      : `e.currentTarget.closest('[data-thq="thq-autocomplete"]').querySelector('[data-thq="thq-autocomplete-input"]')`
    const formStoreUpdate = formStateName
      ? `var setter = ${`set${formStateName.charAt(0).toUpperCase()}${formStateName.slice(
          1
        )}`}; setter(function(prev) { return Object.assign({}, prev, { ['${fieldName}']: text }); });`
      : ''
    handlerCode = `(e) => { var text = (e.currentTarget.textContent || '').trim(); var input = ${inputLookup}; if (input) { input.value = text; } ${formStoreUpdate} ${isOpenSetterName}(false); }`
    const handler = parseJSExpressionAsAST(handlerCode)
    elementTag.openingElement.attributes.push(
      types.jsxAttribute(types.jsxIdentifier('onClick'), types.jsxExpressionContainer(handler))
    )
  }

  // thq-autocomplete-clear: add onClick to clear the input value and close dropdown
  if (dataThqValue === 'thq-autocomplete-clear' && params.autocompleteContext) {
    const { fieldName, formStateName, isOpenStateName, inputHtmlId } = params.autocompleteContext
    const isOpenSetterName = `set${isOpenStateName.charAt(0).toUpperCase()}${isOpenStateName.slice(
      1
    )}`

    let handlerCode: string
    const clearInputLookup = inputHtmlId
      ? `document.getElementById('${inputHtmlId}')`
      : `e.currentTarget.closest('[data-thq="thq-autocomplete"]').querySelector('[data-thq="thq-autocomplete-input"]')`
    const clearFormStoreUpdate = formStateName
      ? `var setter = ${`set${formStateName.charAt(0).toUpperCase()}${formStateName.slice(
          1
        )}`}; setter(function(prev) { return Object.assign({}, prev, { ['${fieldName}']: '' }); });`
      : ''
    handlerCode = `(e) => { var input = ${clearInputLookup}; if (input) { input.value = ''; } ${clearFormStoreUpdate} ${isOpenSetterName}(false); }`
    const handler = parseJSExpressionAsAST(handlerCode)
    elementTag.openingElement.attributes.push(
      types.jsxAttribute(types.jsxIdentifier('onClick'), types.jsxExpressionContainer(handler))
    )
  }

  // A markdown-node can carry its rich-text content as a dynamic/expr child
  // (e.g. CMS-bound rich text) rather than as a `raw` attribute. The raw-attribute
  // path is handled in addAttributesToJSXTag; here we handle the children path so
  // the content is injected as HTML (dangerouslySetInnerHTML) instead of being
  // printed as an escaped raw value by the generic expression handler.
  const isMarkdownNode =
    node.content.semanticType === 'markdown-node' || originalElementName === 'markdown-node'
  const hasRawAttr = attrs
    ? Object.keys(attrs).some((attrKey) => attrs[attrKey]?.type === 'raw')
    : false

  let markdownChildrenHandled = false
  if (isMarkdownNode && !selfClosing && !hasRawAttr && children && children.length > 0) {
    const markdownChild = children.find(
      (child) => child.type === 'expr' || child.type === 'dynamic'
    )
    let markdownExpr: types.Expression | undefined
    if (markdownChild?.type === 'expr') {
      markdownExpr = ASTUtils.getExpressionFromUIDLExpressionNode(markdownChild)
    } else if (markdownChild?.type === 'dynamic') {
      markdownExpr = resolveDynamicReferenceExpression(markdownChild, childParams, options)
    }
    if (markdownExpr) {
      injectMarkdownExpression(elementTag, markdownExpr, '', childParams)
      markdownChildrenHandled = true
    }
  }

  if (!markdownChildrenHandled && !selfClosing && children) {
    // Reorder children to ensure search nodes appear before DataProvider nodes
    const reorderedChildren = reorderChildrenForSearch(children)

    reorderedChildren.forEach((child) => {
      const childTags = generateNode(child, childParams, options)
      childTags.forEach((childTag) => {
        if (typeof childTag === 'string') {
          addChildJSXText(elementTag, childTag)
        } else if (childTag.type === 'JSXExpressionContainer' || childTag.type === 'JSXElement') {
          addChildJSXTag(elementTag, childTag)
        } else {
          addChildJSXTag(elementTag, types.jsxExpressionContainer(childTag))
        }
      })
    })
  }

  if (dependency && isReactChartjs2Chart(dependency, originalElementName)) {
    const wrapped = wrapReactChartJs2Element(elementTag, node)
    nodesLookup[key] = wrapped
    return wrapped
  }

  if (dependency && isCalendarKitScheduler(dependency, originalElementName)) {
    wrapCalendarKitEventsAttr(elementTag)
  }

  nodesLookup[key] = elementTag
  return elementTag
}

export default generateElementNode

const addAttributesToJSXTag = (
  attrs: UIDLElement['attrs'],
  elementTag: types.JSXElement,
  options: JSXGenerationOptions,
  params: JSXGenerationParams,
  elementName?: string
) => {
  Object.keys(attrs ?? {}).forEach((attrKey) => {
    const attributeValue = attrs[attrKey]

    if (!attributeValue.type) {
      return
    }

    // Skip code-gen directives - handled in generateElementNode
    if (attrKey === 'data-store-values-state') {
      return
    }

    // Plan v15 Layer 4 — codegen safety net.
    //
    // Drop attributes that look like AI fabrication artefacts even when the
    // upstream pipeline missed them. These never produce valid DOM/JSX:
    //   1. attr names that are pure JS literals (`true`, `false`, bare
    //      numbers, `null`, `undefined`) — e.g. the `true="true"` that
    //      shipped with the broken Navigation in the 2026-05-24 run.
    //   2. static string values that contain entity-escaped binding markers
    //      (`&#123;` / `&#125;`) — emitting them produces broken DOM text.
    //   3. static string values that contain an UNBALANCED `{{` (no
    //      matching `}}`) — always garbage, never valid.
    if (isJunkAttributeName(attrKey)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[codegen safety net] dropping junk-name attribute "${attrKey}" on <${
          elementName ?? 'element'
        }>`
      )
      return
    }
    if (attributeValue.type === 'static') {
      const staticContent = (attributeValue as { content?: unknown }).content
      if (typeof staticContent === 'string' && hasCorruptBindingMarkers(staticContent)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[codegen safety net] dropping attribute "${attrKey}" on <${
            elementName ?? 'element'
          }> — value has entity-escaped or truncated binding markers (${truncate(staticContent)})`
        )
        return
      }
    }

    switch (attributeValue.type) {
      case 'dynamic':
        const dynamicRef = attributeValue as UIDLDynamicReference
        const {
          content: { referenceType },
        } = dynamicRef

        if (referenceType === 'global') {
          const normRef = normalizeGlobalRef(dynamicRef)
          params.globalReferences.push(
            normRef.content.id as Parameters<typeof params.globalReferences.push>[0]
          )
          // Use the normalized ref to generate the attribute expression
          const globalExpr = createDynamicValueExpression(normRef, options)
          elementTag.openingElement.attributes.push(
            types.jsxAttribute(
              types.jsxIdentifier(convertToReactAttributeName(attrKey)),
              types.jsxExpressionContainer(globalExpr)
            )
          )
          break
        }

        if ((referenceType as string) === 'globalState') {
          const gsName = resolveGlobalStateName(
            dynamicRef.content.id,
            params.globalStateDefinitions
          )
          params.globalStateReferences.push({ id: dynamicRef.content.id, name: gsName })
          const expr = createGlobalStateExpression(dynamicRef as any, params.globalStateDefinitions)
          elementTag.openingElement.attributes.push(
            types.jsxAttribute(
              types.jsxIdentifier(convertToReactAttributeName(attrKey)),
              types.jsxExpressionContainer(expr)
            )
          )
          break
        }

        switch (referenceType) {
          default:
            const prefix =
              options.dynamicReferencePrefixMap[referenceType as 'prop' | 'state' | 'local'] || ''
            const idWithRefPath = UIDLUtils.generateIdWithRefPath(
              dynamicRef.content.id,
              dynamicRef.content.refPath
            )
            addDynamicAttributeToJSXTag(elementTag, attrKey, idWithRefPath, prefix)

            break
        }
        break
      case 'import':
        addDynamicAttributeToJSXTag(elementTag, attrKey, attributeValue.content.id)
        break
      case 'raw': {
        const rawValue = attributeValue as UIDLRawValue
        if (elementName === 'markdown-node') {
          if (rawValue.dynamic) {
            applyDynamicMarkdownInjection(elementTag, rawValue, params, options)
          } else {
            applyStaticMarkdownInjection(elementTag, rawValue, params)
          }
          break
        }
        if (elementName === 'rich-text-editor-node') {
          applyRichTextEditorRawAttribute(elementTag, attrKey, rawValue, params, options)
          break
        }
        if (rawValue.dynamic) {
          applyDynamicHtmlInjection(elementTag, rawValue, params, options)
          break
        }
        addRawAttributeToJSXTag(elementTag, attrKey, attributeValue)
        break
      }
      case 'comp-style':
        addAttributeToJSXTag(elementTag, attrKey, attributeValue.content)
        break
      case 'static':
        if (
          typeof attributeValue.content === 'object' &&
          attributeValue.content !== null &&
          !Array.isArray(attributeValue.content)
        ) {
          const constName = `__staticProp${params.hoistedConstants.length}`
          const expression = objectToObjectExpression(
            attributeValue.content as Record<string, unknown>
          )
          params.hoistedConstants.push({ name: constName, expression })
          elementTag.openingElement.attributes.push(
            types.jsxAttribute(
              types.jsxIdentifier(convertToReactAttributeName(attrKey)),
              types.jsxExpressionContainer(types.identifier(constName))
            )
          )
        } else {
          addAttributeToJSXTag(elementTag, attrKey, attributeValue.content)
        }
        break
      case 'expr':
        addDynamicExpressionAttributeToJSXTag(elementTag, attributeValue, attrKey)
        // Scan the *sanitized* content so any globals introduced by the
        // repair (e.g. `/profile/${}` → `/profile/${currentUser?.id}`) still
        // trigger the downstream useGlobalContext() wiring.
        trackGlobalRefsInExpression(
          sanitizeExprContent(String(attributeValue.content), attrKey),
          params
        )
        break

      case 'element':
        addAttributeToJSXTag(
          elementTag,
          attrKey,
          generateElementNode(attributeValue, params, options)
        )

        break

      case 'object': {
        const content = attributeValue.content
        if (typeof content !== 'object') {
          return
        }
        const expression = objectToObjectExpression(content as Record<string, unknown>)
        elementTag.openingElement.attributes.push(
          types.jsxAttribute(types.jsxIdentifier(attrKey), types.jsxExpressionContainer(expression))
        )
        break
      }

      default:
        throw new Error(
          `generateElementNode could not generate code for attribute of type ${JSON.stringify(
            attributeValue
          )}`
        )
    }
  })
}

/**
 * Converts text containing {{ expr }} templates into a mix of JSX text and expression containers.
 * e.g. "x{{ (state.score / 10) || '0' }}" → ["x", JSXExpressionContainer((score / 10) || '0')]
 *
 * Uses parseStringWithTemplateExpressions to parse the template into a TemplateLiteral AST,
 * then converts its quasis (text parts) and expressions into JSX children.
 */
const convertTextTemplateToJSX = (text: string): JSXASTReturnType[] => {
  try {
    const templateLiteral = parseStringWithTemplateExpressions(text)
    const result: JSXASTReturnType[] = []

    for (let i = 0; i < templateLiteral.quasis.length; i++) {
      const quasi = templateLiteral.quasis[i]
      const textPart = quasi.value.cooked || quasi.value.raw
      if (textPart) {
        result.push(StringUtils.encode(textPart))
      }
      if (i < templateLiteral.expressions.length) {
        result.push(
          types.jsxExpressionContainer(templateLiteral.expressions[i] as types.Expression)
        )
      }
    }

    return result.length > 0 ? result : [StringUtils.encode(text)]
  } catch {
    // If parsing fails, fall back to encoded text
    return [StringUtils.encode(text)]
  }
}

const generateNode: NodeToJSX<UIDLNode, JSXASTReturnType[]> = (node, params, options) => {
  switch (node.type) {
    case 'expr':
      return [generateExpressionNode(node, params, options)]

    case 'raw': {
      const rawNode = node as UIDLRawValue
      if (rawNode.dynamic) {
        const dynamicExpr = resolveDynamicReferenceExpression(rawNode.dynamic, params, options)
        const fallback = rawNode.fallback || rawNode.content
        return [ASTBuilders.createDynamicDOMInjectionNode(dynamicExpr, fallback)]
      }
      return [
        options.domHTMLInjection
          ? options.domHTMLInjection(node.content.toString())
          : node.content.toString(),
      ]
    }

    case 'inject':
      if (node?.dependency) {
        params.dependencies.Script = node.dependency
      }
      return [node.content.toString()]

    case 'static': {
      const textContent = node.content.toString()
      // Check if the text contains {{ }} template expressions
      if (/\{\{/.test(textContent)) {
        return convertTextTemplateToJSX(textContent)
      }
      return [StringUtils.encode(textContent)]
    }

    case 'dynamic':
      switch (node.content.referenceType) {
        case 'prop': {
          // If the dynamic node is a prop and has a default value of type UIDLElementNode,
          // we should use it with a logical expression.
          const prop = params.propDefinitions[node.content.id]
          if (prop?.type === 'element' && prop.defaultValue) {
            const prefix = options.dynamicReferencePrefixMap[node.content.referenceType] || ''

            const propDefault = prop.defaultValue as UIDLElementNode
            const jsxNode = params.nodesLookup[propDefault.content.key]

            if (jsxNode === undefined) {
              throw Error(`Prop ${node.content.id} is of type element \n
              The JSXNode of the prop-${node.content.id} is missing from the nodesLookup`)
            }

            return [
              types.logicalExpression(
                '??',
                prefix === ''
                  ? types.identifier(node.content.id)
                  : types.memberExpression(
                      types.identifier(prefix),
                      types.identifier(node.content.id)
                    ),
                jsxNode as types.JSXElement
              ),
            ]
          }

          return [createDynamicValueExpression(node, options)]
        }

        case 'locale': {
          // Locale is not handled the same in all frameworks.
          // So, we need to handle it differently using individual plugins for each framework.
          const emptyExpression = types.jsxEmptyExpression()
          emptyExpression.innerComments = [
            {
              type: 'CommentBlock',
              value: `locale-${node.content.id}`,
            },
          ]
          const expression = types.jsxExpressionContainer(emptyExpression)
          const jsxTag = createJSXTag('span')
          addChildJSXTag(jsxTag, expression)

          params.localeReferences.push(jsxTag)
          return [jsxTag]
        }

        case 'global': {
          const globalNode = normalizeGlobalRef(node)
          params.globalReferences.push(
            globalNode.content.id as Parameters<typeof params.globalReferences.push>[0]
          )
          return [createDynamicValueExpression(globalNode, options)]
        }

        default:
          if ((node.content.referenceType as string) === 'globalState') {
            const gsName = resolveGlobalStateName(node.content.id, params.globalStateDefinitions)
            params.globalStateReferences.push({ id: node.content.id, name: gsName })
            return [
              createGlobalStateExpression(
                node as any,
                params.globalStateDefinitions
              ) as JSXASTReturnType,
            ]
          }
          return [createDynamicValueExpression(node, options)]
      }

    case 'cms-item':
    case 'cms-list':
      return generateCMSNode(node, params, options)

    case 'cms-list-repeater':
      return generateCMSListRepeaterNode(node, params, options)

    case 'cms-mixed-type':
      return generateCMSMixedTypeNode(node, params, options)

    case 'data-source-item':
    case 'data-source-list':
      return generateDataSourceNode(node, params, options)

    case 'element': {
      // Check if this element node is wrapping a data-source node
      if (
        node.content &&
        typeof node.content === 'object' &&
        'type' in node.content &&
        (node.content.type === 'data-source-item' || node.content.type === 'data-source-list')
      ) {
        // Treat it as a data-source node
        // tslint:disable-next-line:no-any
        return generateDataSourceNode(node.content as any, params, options)
      }
      const elementTag = generateElementNode(node, params, options)
      const renderingConditions = (node.content as UIDLElement | undefined)?.renderingConditions
      if (renderingConditions) {
        return [
          wrapWithConditional(
            elementTag,
            renderingConditions.reference,
            renderingConditions.condition,
            params,
            options
          ),
        ]
      }
      return [elementTag]
    }

    case 'repeat':
      return generateRepeatNode(node, params, options)

    case 'conditional':
      return generateConditionalNode(node, params, options)

    case 'slot':
      if (options.slotHandling === 'native') {
        return [generateNativeSlotNode(node, params, options)]
      } else {
        return generatePropsSlotNode(node, params, options)
      }

    default:
      throw new Error(
        `generateNodeSyntax encountered a node of unsupported type: ${JSON.stringify(
          node,
          null,
          2
        )}`
      )
  }
}

const generateExpressionNode: NodeToJSX<UIDLExpressionValue, types.JSXExpressionContainer> = (
  node
) => {
  const expression = ASTUtils.getExpressionFromUIDLExpressionNode(node)

  // Wrap expression to safely handle objects/arrays: (typeof val === 'object' && val !== null) ? JSON.stringify(val) : val
  const safeExpression = types.conditionalExpression(
    types.logicalExpression(
      '&&',
      types.binaryExpression(
        '===',
        types.unaryExpression('typeof', expression, true),
        types.stringLiteral('object')
      ),
      types.binaryExpression('!==', expression, types.nullLiteral())
    ),
    types.callExpression(
      types.memberExpression(types.identifier('JSON'), types.identifier('stringify')),
      [expression]
    ),
    expression
  )

  return types.jsxExpressionContainer(safeExpression)
}

const generateCMSMixedTypeNode: NodeToJSX<UIDLCMSMixedTypeNode, types.JSXElement[]> = (
  node,
  params,
  options
) => {
  const {
    nodes: { error, fallback },
    elementType,
    renderPropIdentifier,
    mappings = {},
    attrs,
    dependency,
  } = node.content
  const jsxTag = StringUtils.dashCaseToUpperCamelCase(elementType)
  const cmsMixedNode = ASTBuilders.createJSXTag(jsxTag, [], true)
  const mappingsObject: types.ObjectProperty[] = []

  if (attrs) {
    addAttributesToJSXTag(attrs, cmsMixedNode, options, params)
  }

  if (dependency) {
    params.dependencies[elementType] = dependency
  }

  Object.keys(mappings).forEach((key) => {
    const element = generateElementNode(mappings[key], params, options)
    mappingsObject.push(
      types.objectProperty(
        types.identifier(`"${key}"`),
        types.arrowFunctionExpression([types.identifier(renderPropIdentifier)], element)
      )
    )
  })

  cmsMixedNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('mappingConfiguration'),
      types.jsxExpressionContainer(types.objectExpression(mappingsObject))
    )
  )

  if (fallback) {
    cmsMixedNode.openingElement.attributes.push(
      types.jSXAttribute(
        types.jsxIdentifier('renderDefault'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [types.identifier(renderPropIdentifier)],
            generateElementNode(fallback, params, options)
          )
        )
      )
    )
  }

  if (error) {
    cmsMixedNode.openingElement.attributes.push(
      types.jSXAttribute(
        types.jsxIdentifier('renderError'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [types.identifier(renderPropIdentifier)],
            generateElementNode(error, params, options)
          )
        )
      )
    )
  }

  return [cmsMixedNode]
}

const generateCMSNode: NodeToJSX<UIDLCMSListNode | UIDLCMSItemNode, types.JSXElement[]> = (
  node,
  params,
  options
) => {
  const {
    initialData,
    key,
    renderPropIdentifier,
    resource: { params: resourceParams } = {},
    router,
    elementType,
    dependency,
  } = node.content
  const { loading, error, success } = node.content.nodes
  const jsxTag = StringUtils.dashCaseToUpperCamelCase(elementType)

  if (router && options?.dependencyHandling === 'import') {
    params.dependencies.useRouter = router
  }

  if (!success) {
    return []
  }

  if (dependency && options.dependencyHandling === 'import') {
    params.dependencies[elementType] = dependency
  }

  const cmsNode = ASTBuilders.createJSXTag(jsxTag, [], true)

  const cmsDataNodeIdAttr = (node.content as { attrs?: { dataNodeId?: { content?: string } } })
    .attrs?.dataNodeId
  if (cmsDataNodeIdAttr?.content) {
    addAttributeToJSXTag(cmsNode, 'dataNodeId', cmsDataNodeIdAttr.content)
  }

  if (node.type === 'cms-item') {
    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderSuccess'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [types.identifier(renderPropIdentifier)],
            generateNode(success, params, {
              ...options,
              localIdentifier: renderPropIdentifier,
            })[0] as types.JSXElement
          )
        )
      )
    )
  }

  if (node.type === 'cms-list') {
    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderSuccess'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [types.identifier('params')],
            generateNode(success, params, options)[0] as types.JSXElement
          )
        )
      )
    )
  }
  if (dependency && options.dependencyHandling === 'import') {
    params.dependencies.Repeater = dependency
  }
  if (loading) {
    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderLoading'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [],
            generateNode(loading, params, options)[0] as types.JSXElement
          )
        )
      )
    )
  }

  if (error) {
    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderError'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [],
            generateNode(error, params, options)[0] as types.JSXElement
          )
        )
      )
    )
  }

  if (initialData && initialData.content.referenceType) {
    const refType = initialData.content.referenceType as 'prop' | 'state' | 'local'
    const initialDataExpr =
      refType === 'prop'
        ? types.memberExpression(
            types.identifier(options.dynamicReferencePrefixMap[refType]),
            types.identifier(initialData.content.id)
          )
        : types.identifier(initialData.content.id)

    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('initialData'),
        types.jsxExpressionContainer(initialDataExpr)
      )
    )

    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('persistDataDuringLoading'),
        types.jsxExpressionContainer(types.booleanLiteral(true))
      )
    )

    if (refType === 'prop') {
      let keyValue = 'props?.pagination?.page'

      if (node.type === 'cms-item') {
        const { entityKeyProperty } = node.content
        const entityName = initialData.content.id
        keyValue = entityKeyProperty
          ? `props?.${entityName}?.${entityKeyProperty}`
          : `props?.${entityName}?.id`
      }

      cmsNode.openingElement.attributes.push(
        types.jsxAttribute(
          types.jsxIdentifier('key'),
          types.jsxExpressionContainer(types.identifier(keyValue))
        )
      )
    }
  }

  if (Object.keys(resourceParams || {}).length > 0) {
    const nodeParams: types.ObjectProperty[] = Object.keys(resourceParams).reduce(
      (acc: types.ObjectProperty[], attrKey) => {
        const property = resourceParams[attrKey]

        if (property.type === 'static') {
          acc.push(types.objectProperty(types.stringLiteral(attrKey), resolveObjectValue(property)))
        }

        if (property.type === 'expr') {
          const expression = ASTUtils.getExpressionFromUIDLExpressionNode(property)
          acc.push(types.objectProperty(types.stringLiteral(attrKey), expression))
        }

        if (property.type === 'dynamic') {
          acc.push(
            types.objectProperty(
              types.stringLiteral(attrKey),
              property.content.referenceType === 'prop'
                ? types.memberExpression(
                    types.identifier(
                      options.dynamicReferencePrefixMap[property.content.referenceType]
                    ),
                    types.identifier(property.content.id)
                  )
                : types.identifier(property.content.id)
            )
          )
        }

        return acc
      },
      []
    )
    cmsNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('params'),
        types.jsxExpressionContainer(types.objectExpression(nodeParams))
      )
    )
  }

  params.nodesLookup[key] = cmsNode
  return [cmsNode]
}

const generateDataSourceNode: NodeToJSX<
  UIDLDataSourceItemNode | UIDLDataSourceListNode,
  types.JSXElement[]
> = (node, params, options) => {
  const { renderPropIdentifier, elementType, dependency, resourceDefinition } = node.content

  const key = node.content.key || `ds-${resourceDefinition.dataSourceId}-${Date.now()}`
  const name = node.content.name || renderPropIdentifier

  // tslint:disable-next-line:no-any
  const children =
    node.content.children && node.content.children.length > 0
      ? node.content.children
      : (node.content as any).nodes?.success
      ? [(node.content as any).nodes.success]
      : []

  const jsxTag = StringUtils.dashCaseToUpperCamelCase(elementType)

  if (dependency && options.dependencyHandling === 'import') {
    params.dependencies[elementType] = dependency
  }

  const dataSourceNode = ASTBuilders.createJSXTag(jsxTag, [], true)

  const dataSourceDataNodeIdAttr = (
    node.content as { attrs?: { dataNodeId?: { content?: string } } }
  ).attrs?.dataNodeId
  if (dataSourceDataNodeIdAttr?.content) {
    addAttributeToJSXTag(dataSourceNode, 'dataNodeId', dataSourceDataNodeIdAttr.content)
  }

  dataSourceNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('resourceDefinition'),
      types.jsxExpressionContainer(
        types.objectExpression([
          types.objectProperty(
            types.stringLiteral('type'),
            types.stringLiteral('external-data-source')
          ),
          types.objectProperty(
            types.stringLiteral('dataSourceId'),
            types.stringLiteral(resourceDefinition.dataSourceId)
          ),
          types.objectProperty(
            types.stringLiteral('tableName'),
            types.stringLiteral(resourceDefinition.tableName)
          ),
          types.objectProperty(
            types.stringLiteral('dataSourceType'),
            types.stringLiteral(resourceDefinition.dataSourceType)
          ),
        ])
      )
    )
  )

  dataSourceNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('name'),
      types.jsxExpressionContainer(types.stringLiteral(name))
    )
  )

  if (children && children.length > 0) {
    // Pass the render prop identifier as the 'ctx' prefix for data source context references
    // and as the localIdentifier so conditional nodes resolve local refs correctly
    const childOptions = {
      ...options,
      localIdentifier: renderPropIdentifier,
      dynamicReferencePrefixMap: {
        ...options.dynamicReferencePrefixMap,
        ctx: renderPropIdentifier,
      },
    }
    const childrenNodes = children.flatMap((child) => generateNode(child, params, childOptions))
    const renderFunction = types.arrowFunctionExpression(
      [types.identifier(renderPropIdentifier)],
      types.jsxFragment(
        types.jsxOpeningFragment(),
        types.jsxClosingFragment(),
        childrenNodes as types.JSXElement[]
      )
    )
    dataSourceNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderSuccess'),
        types.jsxExpressionContainer(renderFunction)
      )
    )
  }

  // tslint:disable-next-line:no-any
  if ((node.content as any).nodes?.loading) {
    // tslint:disable-next-line:no-any
    const loadingNode = generateNode((node.content as any).nodes.loading, params, options)[0]
    dataSourceNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderLoading'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression([], loadingNode as types.JSXElement)
        )
      )
    )
  }

  // tslint:disable-next-line:no-any
  if ((node.content as any).nodes?.error) {
    // tslint:disable-next-line:no-any
    const errorNode = generateNode((node.content as any).nodes.error, params, options)[0]
    dataSourceNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderError'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression([], errorNode as types.JSXElement)
        )
      )
    )
  }

  // Add resource params if they exist
  // tslint:disable-next-line:no-any
  const resourceParams = (node.content as any).resource?.params
  if (resourceParams && Object.keys(resourceParams).length > 0) {
    const nodeParams: types.ObjectProperty[] = Object.keys(resourceParams).reduce(
      (acc: types.ObjectProperty[], attrKey) => {
        const property = resourceParams[attrKey]

        if (property.type === 'static') {
          // Special handling for filters array - convert dynamic destinations
          if (attrKey === 'filters' && Array.isArray(property.content)) {
            acc.push(
              types.objectProperty(
                types.stringLiteral(attrKey),
                types.arrayExpression(
                  property.content.map(
                    (filter: { source?: string; destination?: unknown; operand?: string }) =>
                      types.objectExpression([
                        types.objectProperty(
                          types.identifier('source'),
                          types.stringLiteral(filter.source || '')
                        ),
                        types.objectProperty(
                          types.identifier('destination'),
                          ASTUtils.convertFilterDestinationToExpression(filter.destination, {
                            dynamicReferencePrefixMap: options.dynamicReferencePrefixMap,
                          })
                        ),
                        types.objectProperty(
                          types.identifier('operand'),
                          types.stringLiteral(filter.operand || '')
                        ),
                      ])
                  )
                )
              )
            )
          } else {
            acc.push(
              types.objectProperty(types.stringLiteral(attrKey), resolveObjectValue(property))
            )
          }
        }

        if (property.type === 'expr') {
          const expression = ASTUtils.getExpressionFromUIDLExpressionNode(property)
          acc.push(types.objectProperty(types.stringLiteral(attrKey), expression))
        }

        if (property.type === 'dynamic') {
          const refType = property.content.referenceType as 'prop' | 'state' | 'local'
          acc.push(
            types.objectProperty(
              types.stringLiteral(attrKey),
              property.content.referenceType === 'prop'
                ? types.memberExpression(
                    types.identifier(options.dynamicReferencePrefixMap[refType]),
                    types.identifier(property.content.id)
                  )
                : types.identifier(property.content.id)
            )
          )
        }

        return acc
      },
      []
    )
    dataSourceNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('params'),
        types.jsxExpressionContainer(types.objectExpression(nodeParams))
      )
    )
  }

  // Add initialData if the UIDL node has it (similar to CMS nodes)
  // tslint:disable-next-line:no-any
  const nodeInitialData = (node.content as any).initialData
  if (nodeInitialData && nodeInitialData.content?.referenceType) {
    const refType = nodeInitialData.content.referenceType as 'prop' | 'state' | 'local'
    const initialDataExpr =
      refType === 'prop'
        ? types.memberExpression(
            types.identifier(options.dynamicReferencePrefixMap[refType]),
            types.identifier(nodeInitialData.content.id)
          )
        : types.identifier(nodeInitialData.content.id)

    dataSourceNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('initialData'),
        types.jsxExpressionContainer(initialDataExpr)
      )
    )

    dataSourceNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('persistDataDuringLoading'),
        types.jsxExpressionContainer(types.booleanLiteral(true))
      )
    )
  }

  params.nodesLookup[key] = dataSourceNode
  return [dataSourceNode]
}

const generateRepeatNode: NodeToJSX<UIDLRepeatNode, types.JSXExpressionContainer[]> = (
  node,
  params,
  options
) => {
  const { node: repeatContent, dataSource, meta } = node.content
  const { iteratorName, iteratorKey } = UIDLUtils.getRepeatIteratorNameAndKey(meta)
  const contentASTs = generateNode(repeatContent, params, {
    ...options,
    localIdentifier: iteratorName,
  }) as types.JSXElement[]

  const localIteratorPrefix = options.dynamicReferencePrefixMap.local
  contentASTs.forEach((contentAST) => {
    addDynamicAttributeToJSXTag(contentAST, 'key', iteratorKey, localIteratorPrefix)
  })

  const source = getRepeatSourceIdentifier(dataSource, options)

  const arrowFunctionArguments = [types.identifier(iteratorName)]
  if (meta.useIndex) {
    arrowFunctionArguments.push(types.identifier('index'))
  }

  return contentASTs.map((contentAST) =>
    types.jsxExpressionContainer(
      types.callExpression(types.memberExpression(source, types.identifier('map')), [
        types.arrowFunctionExpression(arrowFunctionArguments, contentAST),
      ])
    )
  )
}

// Shared between UIDLConditionalNode (wraps a child subtree) and the inline
// `renderingConditions` property on UIDLElement content. Tracks global and
// globalState references on params, resolves the condition identifier, and
// builds the `condition && <content/>` logical expression.
const wrapWithConditional = (
  subTree: JSXASTReturnType,
  reference: UIDLConditionalNode['content']['reference'],
  condition: UIDLConditionalExpression,
  params: JSXGenerationParams,
  options: JSXGenerationOptions
): types.LogicalExpression => {
  if (
    reference.type === 'dynamic' &&
    'referenceType' in reference.content &&
    reference.content.referenceType === 'global'
  ) {
    const normCondRef = normalizeGlobalRef(reference as any)
    params.globalReferences.push(
      normCondRef.content.id as Parameters<typeof params.globalReferences.push>[0]
    )
  }

  if (
    reference.type === 'dynamic' &&
    'referenceType' in reference.content &&
    (reference.content.referenceType as string) === 'globalState'
  ) {
    const gsName = resolveGlobalStateName(reference.content.id, params.globalStateDefinitions)
    params.globalStateReferences.push({ id: reference.content.id, name: gsName })
  }

  const effectiveRef =
    reference.type === 'dynamic' &&
    'referenceType' in reference.content &&
    reference.content.referenceType === 'global'
      ? (normalizeGlobalRef(reference as any) as typeof reference)
      : reference
  const conditionIdentifier = createConditionIdentifier(effectiveRef, params, options)
  return createConditionalJSXExpression(subTree, condition, conditionIdentifier, {
    localIdentifier: options.localIdentifier,
    detailsPageExposeAsName: options.detailsPageExposeAsName || params.detailsPageExposeAsName,
  })
}

const generateConditionalNode: NodeToJSX<UIDLConditionalNode, types.LogicalExpression[]> = (
  node,
  params,
  options
) => {
  const { reference, value } = node.content
  const subTrees = generateNode(node.content.node, params, options)

  const condition: UIDLConditionalExpression =
    value !== undefined && value !== null
      ? { conditions: [{ operand: value, operation: '===' }] }
      : node.content.condition

  return subTrees.map((subTree) =>
    wrapWithConditional(subTree, reference, condition, params, options)
  )
}

const generateCMSListRepeaterNode: NodeToJSX<UIDLCMSListRepeaterNode, types.JSXElement[]> = (
  node,
  params,
  options
) => {
  const jsxTag = StringUtils.dashCaseToUpperCamelCase(node.content.elementType)
  const repeaterNode = ASTBuilders.createJSXTag(jsxTag, [], true)

  const dataNodeIdAttr = (node.content as { attrs?: { dataNodeId?: { content?: string } } }).attrs
    ?.dataNodeId
  if (dataNodeIdAttr?.content) {
    addAttributeToJSXTag(repeaterNode, 'dataNodeId', dataNodeIdAttr.content)
  }

  // When the repeater source is a global context like "ecommerce", resolve to
  // the appropriate array from the ecommerce context based on what the repeater
  // iterates over (determined by renderPropIdentifier).
  let repeaterItemsExpr: types.Expression
  const source = node.content.source ?? 'params'
  if (source === 'ecommerce') {
    const rpId = node.content.renderPropIdentifier || ''
    // Map renderPropIdentifier to the correct ecommerce context path
    const ecommercePathMap: Record<string, string[]> = {
      paymentProvider: ['paymentProviders'],
      storeLocation: ['storeLocations'],
    }
    // Default: cart items for orderItem, cartItem, or any unrecognized identifier
    const path = ecommercePathMap[rpId] || ['Cart', 'items']

    let expr: types.Expression = types.identifier('ecommerce')
    for (const seg of path) {
      expr = types.optionalMemberExpression(expr, types.identifier(seg), false, true)
    }
    repeaterItemsExpr = types.logicalExpression('||', expr, types.arrayExpression([]))
    params.globalReferences.push('ecommerce' as Parameters<typeof params.globalReferences.push>[0])
  } else {
    // Resolve any global-state reference encoded in `source` and register it
    // so the `next-global-state` component plugin destructures the matching
    // identifier from `useGlobalState()`. Without this, sources emitted as
    // either `<globalStateName> || []` (modern) or `globalState_<defId>`
    // (legacy) compile to a `ReferenceError` at render time because the
    // identifier never enters scope.
    const resolvedSource = resolveAndRegisterGlobalStateSource(source, params)
    repeaterItemsExpr = types.identifier(resolvedSource)
  }

  repeaterNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('items'),
      types.jsxExpressionContainer(repeaterItemsExpr)
    )
  )

  const listElement = generateNode(node.content.nodes.list, params, {
    ...options,
    localIdentifier: node.content.renderPropIdentifier,
    dynamicReferencePrefixMap: {
      ...options.dynamicReferencePrefixMap,
      ctx: node.content.renderPropIdentifier,
    },
  })[0] as types.JSXElement

  // Create key as template literal: `${item?.id}${index}`
  const keyAttribute = types.jsxAttribute(
    types.jsxIdentifier('key'),
    types.jsxExpressionContainer(
      types.templateLiteral(
        [
          types.templateElement({ raw: '', cooked: '' }, false),
          types.templateElement({ raw: '', cooked: '' }, false),
          types.templateElement({ raw: '', cooked: '' }, true),
        ],
        [
          types.optionalMemberExpression(
            types.identifier(node.content.renderPropIdentifier),
            types.identifier('id'),
            false,
            true
          ),
          types.identifier('index'),
        ]
      )
    )
  )
  listElement.openingElement.attributes.push(keyAttribute)

  repeaterNode.openingElement.attributes.push(
    types.jsxAttribute(
      types.jSXIdentifier('renderItem'),
      types.jsxExpressionContainer(
        types.arrowFunctionExpression(
          [types.identifier(node.content.renderPropIdentifier), types.identifier('index')],
          listElement
        )
      )
    )
  )

  if ('empty' in node.content.nodes) {
    repeaterNode.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('renderEmpty'),
        types.jsxExpressionContainer(
          types.arrowFunctionExpression(
            [],
            generateNode(node.content.nodes.empty, params, options)[0] as types.JSXElement
          )
        )
      )
    )
  }

  if ('loading' in node.content.nodes) {
    generateNode(node.content.nodes.loading, params, options)
  }

  if (node.content?.dependency && options.dependencyHandling === 'import') {
    params.dependencies[jsxTag] = node.content.dependency
  }

  return [repeaterNode]
}

const generatePropsSlotNode: NodeToJSX<UIDLSlotNode, types.JSXExpressionContainer[]> = (
  node: UIDLSlotNode,
  params,
  options
) => {
  // React/Preact do not have native slot nodes and implement this differently through the props.children syntax.
  // Unfortunately, names slots are ignored because React/Preact treat all the inner content of the component as props.children
  const childrenProp: UIDLDynamicReference = {
    type: 'dynamic',
    content: {
      referenceType: 'prop',
      id: 'children',
    },
  }

  const childrenExpression = createDynamicValueExpression(childrenProp, options)

  if (node.content.fallback) {
    const fallbackContents = generateNode(node.content.fallback, params, options)
    // only static dynamic or element are allowed here

    return fallbackContents.map((fallbackContent) => {
      const fallbackNode =
        typeof fallbackContent === 'string'
          ? types.stringLiteral(fallbackContent)
          : (fallbackContent as types.JSXElement | types.MemberExpression)

      // props.children with fallback
      return types.jsxExpressionContainer(
        types.logicalExpression('||', childrenExpression, fallbackNode)
      )
    })
  }

  return [types.jsxExpressionContainer(childrenExpression)]
}

const generateNativeSlotNode: NodeToJSX<UIDLSlotNode, types.JSXElement> = (
  node,
  params,
  options
) => {
  const slotNode = createSelfClosingJSXTag('slot')

  if (node.content.name) {
    addAttributeToJSXTag(slotNode, 'name', node.content.name)
  }

  if (node.content.fallback) {
    const fallbackContents = generateNode(node.content.fallback, params, options)

    fallbackContents.forEach((fallbackContent) => {
      if (typeof fallbackContent === 'string') {
        addChildJSXText(slotNode, fallbackContent)
      } else if (fallbackContent.type === 'MemberExpression') {
        addChildJSXTag(slotNode, types.jsxExpressionContainer(fallbackContent))
      } else {
        addChildJSXTag(slotNode, fallbackContent as types.JSXElement)
      }
    })
  }

  return slotNode
}

const resolveDynamicReferenceExpression = (
  dynamicRef: UIDLDynamicReference,
  params: JSXGenerationParams,
  options: JSXGenerationOptions
): types.Expression => {
  const { referenceType } = dynamicRef.content

  if (referenceType === 'global') {
    const normDynRef = normalizeGlobalRef(dynamicRef)
    params.globalReferences.push(
      normDynRef.content.id as Parameters<typeof params.globalReferences.push>[0]
    )
    return createDynamicValueExpression(normDynRef, options)
  }

  if ((referenceType as string) === 'globalState') {
    const gsName = resolveGlobalStateName(dynamicRef.content.id, params.globalStateDefinitions)
    params.globalStateReferences.push({ id: dynamicRef.content.id, name: gsName })
    return createGlobalStateExpression(
      dynamicRef as any,
      params.globalStateDefinitions
    ) as types.Expression
  }

  return createDynamicValueExpression(dynamicRef, options)
}

const applyDynamicHtmlInjection = (
  elementTag: types.JSXElement,
  rawValue: UIDLRawValue,
  params: JSXGenerationParams,
  options: JSXGenerationOptions
) => {
  const dynamicExpr = resolveDynamicReferenceExpression(rawValue.dynamic, params, options)
  const fallbackContent = rawValue.fallback || rawValue.content
  const fallbackExpr = types.stringLiteral(fallbackContent)
  const valueExpr = types.logicalExpression('||', dynamicExpr, fallbackExpr)

  ;(elementTag.openingElement.name as types.JSXIdentifier).name = 'span'
  if (elementTag.closingElement) {
    ;(elementTag.closingElement.name as types.JSXIdentifier).name = 'span'
  }
  elementTag.openingElement.selfClosing = true
  elementTag.closingElement = null
  elementTag.children = []

  elementTag.openingElement.attributes.push(
    types.jsxAttribute(
      types.jsxIdentifier('dangerouslySetInnerHTML'),
      types.jsxExpressionContainer(
        types.objectExpression([types.objectProperty(types.identifier('__html'), valueExpr)])
      )
    )
  )

  Object.keys(params.dependencies).forEach((key) => {
    if (params.dependencies[key]?.path?.includes('dangerous-html')) {
      delete params.dependencies[key]
    }
  })
}

const applyStaticMarkdownInjection = (
  elementTag: types.JSXElement,
  rawValue: UIDLRawValue,
  params: JSXGenerationParams
) => {
  injectMarkdownExpression(elementTag, types.stringLiteral(rawValue.content || ''), '', params)
}

const applyDynamicMarkdownInjection = (
  elementTag: types.JSXElement,
  rawValue: UIDLRawValue,
  params: JSXGenerationParams,
  options: JSXGenerationOptions
) => {
  const dynamicExpr = resolveDynamicReferenceExpression(rawValue.dynamic, params, options)
  const fallbackContent = rawValue.fallback || rawValue.content
  injectMarkdownExpression(elementTag, dynamicExpr, fallbackContent, params)
}

/**
 * Renders a markdown-node's rich-text content through the `markdown-to-jsx` <Markdown>
 * component (the React generator's mapping for markdown-node).
 *
 * markdown-to-jsx parses BOTH markdown syntax AND embedded HTML, so it renders correctly
 * whether the CMS field returns markdown (`# Heading`) or HTML markup (`<p>…</p>`). A raw
 * HTML approach (dangerouslySetInnerHTML) would ignore markdown, and a markdown-only
 * renderer (react-markdown) escapes HTML — markdown-to-jsx covers both at once.
 *
 * Shared by every way a markdown-node can carry its content:
 * - a static `raw` attribute (see applyStaticMarkdownInjection)
 * - a `raw` attribute holding a dynamic reference (see applyDynamicMarkdownInjection)
 * - a dynamic/expr child, e.g. CMS-bound rich text (see generateElementNode)
 *
 * Produces: <Markdown>{expr || fallback}</Markdown>
 */
const injectMarkdownExpression = (
  elementTag: types.JSXElement,
  expression: types.Expression,
  fallbackContent: string,
  params: JSXGenerationParams
) => {
  // markdown-to-jsx requires a string child; guard dynamic expressions with a fallback so
  // a nullish CMS value renders as empty rather than throwing. Static literals need no guard.
  const childExpr = types.isStringLiteral(expression)
    ? expression
    : types.logicalExpression('||', expression, types.stringLiteral(fallbackContent || ''))

  ;(elementTag.openingElement.name as types.JSXIdentifier).name = 'Markdown'
  elementTag.openingElement.selfClosing = false
  if (!elementTag.closingElement) {
    elementTag.closingElement = types.jsxClosingElement(types.jsxIdentifier('Markdown'))
  } else {
    ;(elementTag.closingElement.name as types.JSXIdentifier).name = 'Markdown'
  }
  elementTag.children = [types.jsxExpressionContainer(childExpr)]

  params.dependencies.Markdown = {
    type: 'package',
    path: 'markdown-to-jsx',
    version: '7.7.12',
  }
}

/**
 * Handles raw attributes on a rich-text-editor-node element.
 *
 * - `html` attribute → becomes a `value` prop (static string or dynamic expression with fallback)
 * - `quillFormats` attribute → parsed from JSON string into a JS array expression
 */
const applyRichTextEditorRawAttribute = (
  elementTag: types.JSXElement,
  attrKey: string,
  rawValue: UIDLRawValue,
  params: JSXGenerationParams,
  options: JSXGenerationOptions
) => {
  if (attrKey === 'html' && params.formStoreStateName) {
    return
  }

  if (attrKey === 'html') {
    if (rawValue.dynamic) {
      const dynamicExpr = resolveDynamicReferenceExpression(rawValue.dynamic, params, options)
      const fallbackContent = rawValue.fallback || rawValue.content || ''
      const valueExpr = types.logicalExpression(
        '||',
        dynamicExpr,
        types.stringLiteral(fallbackContent)
      )
      elementTag.openingElement.attributes.push(
        types.jsxAttribute(types.jsxIdentifier('value'), types.jsxExpressionContainer(valueExpr))
      )
    } else {
      const content = rawValue.content || ''
      addAttributeToJSXTag(elementTag, 'value', content)
    }
    return
  }

  if (attrKey === 'quillFormats') {
    let formats: string[] | null = null
    try {
      const parsed = JSON.parse(rawValue.content)
      if (Array.isArray(parsed)) {
        formats = parsed
      }
    } catch {
      // Parsing failed → don't add the attribute; component will use all formats
    }

    if (formats === null) {
      // Parse failure or not an array → omit attribute so component uses all formats
      return
    }

    const arrayExpr = types.arrayExpression(formats.map((f) => types.stringLiteral(f)))
    elementTag.openingElement.attributes.push(
      types.jsxAttribute(
        types.jsxIdentifier('quillFormats'),
        types.jsxExpressionContainer(arrayExpr)
      )
    )
    return
  }

  // Any other raw attribute on rich-text-editor-node: fall through to default handling
  addRawAttributeToJSXTag(elementTag, attrKey, rawValue)
}
