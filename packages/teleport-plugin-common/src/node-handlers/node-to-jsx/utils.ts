import * as types from '@babel/types'

import {
  convertToBinaryOperator,
  convertToUnaryOperator,
  convertValueToLiteral,
  getExpressionFromUIDLExpressionNode,
} from '../../utils/ast-utils'
import { StringUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  UIDLPropDefinition,
  UIDLAttributeValue,
  UIDLDynamicReference,
  UIDLStateDefinition,
  UIDLEventHandlerStatement,
  UIDLConditionalExpression,
  UIDLPropCallEvent,
  UIDLStateModifierEvent,
  UIDLExpressionValue,
  UIDLGlobalReference,
  UIDLGlobalStateDefinition,
  UIDLGlobalStateReference,
} from '@teleporthq/teleport-types'

import {
  JSXASTReturnType,
  ConditionalIdentifier,
  JSXGenerationParams,
  JSXGenerationOptions,
} from './types'
import { generateIdWithRefPath } from '@teleporthq/teleport-shared/dist/cjs/utils/uidl-utils'

// Adds all the event handlers and all the instructions for each event handler
// in case there is more than one specified in the UIDL
/** HTML form controls that React treats as "controlled" when given a value/checked prop. */
const CONTROLLED_FORM_CONTROL_TAGS = new Set(['input', 'textarea', 'select'])

/**
 * React FREEZES a controlled form control (`value`/`checked` set) that has no
 * `onChange` — the user cannot type and a console warning is logged. This is the
 * classic edit-form failure: entity-bound fields rendered `value={props.item?.x}`
 * with no state mirror (the worker intentionally does not mirror entity columns
 * into state). When an `<input>`/`<textarea>`/`<select>` has a `value` (or a
 * checkbox/radio `checked`) attribute but NO `onChange` handler was attached, and
 * it is not `readOnly`/`disabled`, convert it to UNCONTROLLED — `value`→
 * `defaultValue`, `checked`→`defaultChecked`. The control then pre-fills, stays
 * editable, and its live DOM value is what form-submit workflows read via
 * `document.getElementById(id).value`. Controls that ARE controlled (an onChange
 * was already attached — via UIDL events, the form-store binding, or a workflow
 * trigger) and read-only/disabled display fields are left untouched.
 *
 * Must run AFTER all attributes and event handlers have been added to the tag.
 * Mutates the tag in place; idempotent.
 */
export const makeControlUncontrolledWhenNoChangeHandler = (
  tag: types.JSXElement,
  elementName: string,
  t = types
): void => {
  if (!CONTROLLED_FORM_CONTROL_TAGS.has(elementName.toLowerCase())) {
    return
  }
  const attributes = tag.openingElement.attributes
  const hasNamedAttribute = (name: string): boolean =>
    attributes.some(
      (attr) =>
        attr.type === 'JSXAttribute' &&
        attr.name.type === 'JSXIdentifier' &&
        attr.name.name === name
    )

  // An onChange means it is legitimately controlled; readOnly/disabled inputs are
  // intentionally non-editable display fields (React does not warn on those).
  if (
    hasNamedAttribute('onChange') ||
    hasNamedAttribute('readOnly') ||
    hasNamedAttribute('disabled')
  ) {
    return
  }

  const controlledToUncontrolled: Array<[string, string]> = [
    ['value', 'defaultValue'],
    ['checked', 'defaultChecked'],
  ]
  for (const [controlled, uncontrolled] of controlledToUncontrolled) {
    const index = attributes.findIndex(
      (attr) =>
        attr.type === 'JSXAttribute' &&
        attr.name.type === 'JSXIdentifier' &&
        attr.name.name === controlled
    )
    if (index !== -1) {
      const attr = attributes[index] as types.JSXAttribute
      attributes.splice(index, 1, t.jsxAttribute(t.jsxIdentifier(uncontrolled), attr.value))
    }
  }
}

export const addEventHandlerToTag = (
  tag: types.JSXElement,
  eventKey: string,
  eventHandlerStatements: UIDLEventHandlerStatement[],
  params: JSXGenerationParams,
  options: JSXGenerationOptions,
  t = types
) => {
  const eventHandlerASTStatements: types.ExpressionStatement[] = []
  const { propDefinitions, stateDefinitions } = params

  eventHandlerStatements.forEach((eventHandlerAction) => {
    if (eventHandlerAction.type === 'stateChange') {
      const handler = createStateChangeStatement(eventHandlerAction, stateDefinitions, options)
      if (handler) {
        eventHandlerASTStatements.push(handler)
      }
    }

    if (eventHandlerAction.type === 'propCall') {
      const handler = createPropCallStatement(eventHandlerAction, propDefinitions, options)
      if (handler) {
        eventHandlerASTStatements.push(handler)
      }
    }
  })

  let expressionContent: types.ArrowFunctionExpression | types.Expression
  const functionParams = eventHandlerStatements.some(
    (eventHandler) => eventHandler.includeEventObject
  )
    ? [t.identifier('event')]
    : []

  if (eventHandlerASTStatements.length === 1) {
    const expression = eventHandlerASTStatements[0].expression

    expressionContent =
      expression.type === 'CallExpression' && expression.arguments.length === 0
        ? (expression.callee as types.ArrowFunctionExpression | types.Expression)
        : t.arrowFunctionExpression(functionParams, expression)
  } else {
    expressionContent = t.arrowFunctionExpression(
      functionParams,
      t.blockStatement(eventHandlerASTStatements)
    )
  }

  tag.openingElement.attributes.push(
    t.jsxAttribute(t.jsxIdentifier(eventKey), t.jsxExpressionContainer(expressionContent))
  )
}

const createPropCallStatement = (
  eventHandlerStatement: UIDLPropCallEvent,
  propDefinitions: Record<string, UIDLPropDefinition>,
  options: JSXGenerationOptions,
  t = types
) => {
  const { calls: propFunctionKey, args = [] } = eventHandlerStatement

  if (!propFunctionKey) {
    console.warn(`No prop definition referenced under the "calls" field`)
    return null
  }

  const propDefinition = propDefinitions[propFunctionKey]

  if (!propDefinition || propDefinition.type !== 'func') {
    console.warn(`No prop definition was found for "${propFunctionKey}"`)
    return null
  }

  const prefix = options.dynamicReferencePrefixMap.prop
    ? options.dynamicReferencePrefixMap.prop + '.'
    : ''
  return t.expressionStatement(
    t.callExpression(t.identifier(prefix + propFunctionKey), [
      ...args.map((arg) => convertValueToLiteral(arg)),
    ])
  )
}

/**
 * Plan v14 — Type-aware state setter emitter.
 *
 * The old emitter unconditionally produced `setX(!x)` for `$toggle` and
 * `setX(<literal>)` for primitives, regardless of the declared state
 * type. That broke every multi-step form: `$toggle` on a numeric step
 * state turned `1` into `false`, hiding every `state === N` panel; a
 * primitive written to an object state replaced the whole object.
 *
 * The codegen here is now the safety net for what server-side Layers 1-3
 * could not catch (legacy projects, AI bypass). When a combination is
 * incoherent (e.g. `$toggle` on a number, or a bare string targeting an
 * object), we skip the statement and warn — the workflow runtime handler
 * remains the source of truth. Coherent combinations emit the same code
 * as before, plus four new modifier shapes (`$increment` / `$decrement` /
 * `$patch` / `$append`) that produce React functional setters.
 *
 * Returns `null` when the emitter declines (caller already handles null).
 */
export const createStateChangeStatement = (
  eventHandlerStatement: UIDLStateModifierEvent,
  stateDefinitions: Record<string, UIDLStateDefinition>,
  options: JSXGenerationOptions,
  t = types
) => {
  if (!eventHandlerStatement.modifies) {
    console.warn(`No state identifier referenced under the "modifies" field`)
    return null
  }

  const stateKey = eventHandlerStatement.modifies
  const stateDefinition = stateDefinitions[stateKey]
  if (!stateDefinition) {
    console.warn(
      `State change references an undeclared state "${stateKey}" — skipping setter emission.`
    )
    return null
  }

  const statePrefix = options.dynamicReferencePrefixMap.state
    ? options.dynamicReferencePrefixMap.state + '.'
    : ''

  const declaredType = stateDefinition.type
  const newState = eventHandlerStatement.newState
  let newStateValue: types.Expression | undefined
  let useFunctionalSetter = false
  let functionalSetterBuilder: ((prevId: types.Identifier) => types.Expression) | undefined

  if (newState === '$toggle') {
    // Boolean-only. Reject for number / object / array — emitting `!x`
    // on those types is the v13/v14 regression we are fixing.
    if (declaredType !== 'boolean') {
      console.warn(
        `[createStateChangeStatement] '$toggle' is only valid for boolean state; state "${stateKey}" is declared as ${declaredType}. Skipping setter to avoid corrupting state.`
      )
      return null
    }
    newStateValue = t.unaryExpression('!', t.identifier(statePrefix + stateKey))
  } else if (typeof newState === 'object' && newState !== null) {
    const obj = newState as
      | UIDLDynamicReference
      | UIDLExpressionValue
      | { type: '$increment' | '$decrement'; delta?: number }
      | { type: '$patch'; path: string; value: unknown }
      | { type: '$append'; value: unknown }
    const objType = (obj as { type?: string }).type
    if (objType === 'expr') {
      newStateValue = getExpressionFromUIDLExpressionNode(newState as UIDLExpressionValue)
    } else if (objType === 'dynamic') {
      newStateValue = createDynamicValueExpression(newState as UIDLDynamicReference, options)
    } else if (objType === '$increment' || objType === '$decrement') {
      if (declaredType !== 'number') {
        console.warn(
          `[createStateChangeStatement] '${objType}' requires a numeric state; "${stateKey}" is declared as ${declaredType}. Skipping setter.`
        )
        return null
      }
      // Honor the sign of `delta`: an $increment with delta -2 is a
      // deliberate decrement by 2 (the type doc documents this). The
      // builder emits `prev + delta` for $increment and `prev - delta`
      // for $decrement, then the absolute value of |delta| is the
      // numeric literal we feed in. Math.abs prevents the rare double-
      // negative case where someone writes `{ type: '$decrement', delta: -1 }`
      // (intended +1) from emitting `prev - -1` (which would be `+1`
      // via JS coercion but is unreadable).
      const rawDelta = (obj as { delta?: number }).delta ?? 1
      const operator: '+' | '-' =
        objType === '$increment' ? (rawDelta < 0 ? '-' : '+') : rawDelta < 0 ? '+' : '-'
      const magnitude = Math.abs(rawDelta)
      useFunctionalSetter = true
      functionalSetterBuilder = (prevId) =>
        t.binaryExpression(operator, prevId, t.numericLiteral(magnitude))
    } else if (objType === '$patch') {
      if (declaredType !== 'object') {
        console.warn(
          `[createStateChangeStatement] '$patch' requires an object state; "${stateKey}" is declared as ${declaredType}. Skipping setter.`
        )
        return null
      }
      const patch = obj as { type: '$patch'; path: string; value: unknown }
      if (!patch.path || typeof patch.path !== 'string') {
        console.warn(
          `[createStateChangeStatement] '$patch' requires a string "path"; received "${String(
            patch.path
          )}" for state "${stateKey}". Skipping setter.`
        )
        return null
      }
      const patchValueAst = convertValueToLiteral(
        patch.value as string | number | boolean,
        'string'
      )
      useFunctionalSetter = true
      functionalSetterBuilder = (prevId) =>
        t.objectExpression([
          t.spreadElement(prevId),
          t.objectProperty(t.identifier(patch.path), patchValueAst, false, false),
        ])
    } else if (objType === '$append') {
      if (declaredType !== 'array') {
        console.warn(
          `[createStateChangeStatement] '$append' requires an array state; "${stateKey}" is declared as ${declaredType}. Skipping setter.`
        )
        return null
      }
      const appended = obj as { type: '$append'; value: unknown }
      const appendedValueAst = convertValueToLiteral(
        appended.value as string | number | boolean,
        'string'
      )
      useFunctionalSetter = true
      functionalSetterBuilder = (prevId) =>
        t.arrayExpression([t.spreadElement(prevId), appendedValueAst])
    } else {
      // Unknown object shape — fall back to literal conversion only when
      // the declared type accepts a primitive write.
      if (declaredType === 'object' || declaredType === 'array') {
        console.warn(
          `[createStateChangeStatement] Unrecognised modifier shape on a ${declaredType} state "${stateKey}"; skipping setter to avoid corrupting state.`
        )
        return null
      }
      newStateValue = convertValueToLiteral(newState as unknown as string, declaredType)
    }
  } else {
    // Bare primitive (`'oily'`, `2`, `true`). Coerce against the declared type.
    // For object/array state, writing a primitive REPLACES the structure.
    // That is the bug — fail safe.
    if (declaredType === 'object' || declaredType === 'array') {
      console.warn(
        `[createStateChangeStatement] Refusing to overwrite ${declaredType} state "${stateKey}" with a primitive value (${JSON.stringify(
          newState
        )}). Use '$patch' / '$append' modifiers instead. Skipping setter.`
      )
      return null
    }
    newStateValue = convertValueToLiteral(newState as string | number | boolean, declaredType)
  }

  switch (options.stateHandling) {
    case 'hooks': {
      const setterId = t.identifier(StringUtils.createStateStoringFunction(stateKey))
      if (useFunctionalSetter && functionalSetterBuilder) {
        const prevId = t.identifier('prev')
        const arrow = t.arrowFunctionExpression([prevId], functionalSetterBuilder(prevId))
        return t.expressionStatement(t.callExpression(setterId, [arrow]))
      }
      if (!newStateValue) {
        return null
      }
      return t.expressionStatement(t.callExpression(setterId, [newStateValue]))
    }
    case 'function': {
      // Class-component setState path is legacy; functional setters aren't
      // supported via `this.setState(prev => …)` here, so for the new
      // modifiers we fall back to skipping. The hooks path is the path the
      // multi-step form actually exercises.
      if (useFunctionalSetter) {
        console.warn(
          `[createStateChangeStatement] Functional-setter modifiers are only supported under stateHandling="hooks". Skipping setter for "${stateKey}".`
        )
        return null
      }
      if (!newStateValue) {
        return null
      }
      return t.expressionStatement(
        t.callExpression(t.identifier('this.setState'), [
          t.objectExpression([t.objectProperty(t.identifier(stateKey), newStateValue)]),
        ])
      )
    }
    case 'mutation':
    default: {
      if (useFunctionalSetter) {
        console.warn(
          `[createStateChangeStatement] Functional-setter modifiers are only supported under stateHandling="hooks". Skipping setter for "${stateKey}".`
        )
        return null
      }
      if (!newStateValue) {
        return null
      }
      return t.expressionStatement(
        t.assignmentExpression('=', t.identifier(statePrefix + stateKey), newStateValue)
      )
    }
  }
}

export const resolveGlobalStateName = (
  id: string,
  definitions?: Record<string, UIDLGlobalStateDefinition>
): string => {
  if (!definitions) {
    return id
  }
  for (const def of Object.values(definitions)) {
    if (def.id === id) {
      return def.name
    }
  }
  return id
}

// Matches the leading JS identifier of an expression, e.g. `foo` from
// `foo?.['bar'] || []`. Used to recognise when a string-encoded UIDL source
// (cms-list-repeater `source`) is rooted at a global-state name so the
// generator can register the reference for `useGlobalState()` destructuring.
const LEADING_IDENTIFIER_RE = /^([A-Za-z_$][A-Za-z0-9_$]*)/

// Older versions of the UIDL emitter encoded a global-state reference as the
// magic literal `globalState_<defId>` instead of the declared variable name.
// Detect that prefix so we can rewrite it to the proper identifier and fix
// already-published UIDL documents without forcing them to be regenerated.
const LEGACY_GLOBAL_STATE_RE = /^globalState_([A-Za-z0-9_-]+)/

/**
 * Given a string-encoded UIDL `source` expression, resolve any global-state
 * reference into the proper JS identifier for the generator and ensure the
 * reference is registered for `useGlobalState()` destructuring.
 *
 * Two upstream encodings are accepted:
 *   1. Modern shape — leading identifier is the declared state name
 *      (e.g. `countriesWithDescriptions || []`). We just register it.
 *   2. Legacy shape — leading identifier is the magic placeholder
 *      `globalState_<defId>` (e.g. `globalState_TQ_96vaRH5pdf['key']`). We
 *      rewrite the placeholder to the declared name AND register it.
 *
 * Returns the (possibly rewritten) source string. The caller should embed
 * the returned string instead of the input.
 */
export const resolveAndRegisterGlobalStateSource = (
  source: string | undefined,
  params: JSXGenerationParams
): string => {
  const original = source ?? ''
  if (!original) {
    return original
  }
  const definitions = params.globalStateDefinitions
  if (!definitions || Object.keys(definitions).length === 0) {
    return original
  }

  const legacyMatch = original.match(LEGACY_GLOBAL_STATE_RE)
  if (legacyMatch) {
    const id = legacyMatch[1]
    for (const def of Object.values(definitions)) {
      if (def.id === id) {
        params.globalStateReferences.push({ id: def.id, name: def.name })
        return original.replace(LEGACY_GLOBAL_STATE_RE, def.name)
      }
    }
    // Legacy prefix found but no matching definition (orphaned reference).
    // Leave the source untouched; the downstream identifier creation will
    // still emit something, and a separate sanity pass can flag it.
    return original
  }

  const leadingMatch = original.match(LEADING_IDENTIFIER_RE)
  if (leadingMatch) {
    const leadingName = leadingMatch[1]
    for (const def of Object.values(definitions)) {
      if (def.name === leadingName) {
        params.globalStateReferences.push({ id: def.id, name: def.name })
        return original
      }
    }
  }

  return original
}

export const createGlobalStateExpression = (
  ref: UIDLGlobalStateReference,
  definitions?: Record<string, UIDLGlobalStateDefinition>,
  t = types
): types.Identifier | types.OptionalMemberExpression => {
  const name = resolveGlobalStateName(ref.content.id, definitions)
  const refPath = ref.content.refPath || []

  if (refPath.length === 0) {
    return t.identifier(name)
  }

  let expr: types.Identifier | types.OptionalMemberExpression = t.identifier(name)
  for (const segment of refPath) {
    expr = t.optionalMemberExpression(expr, t.identifier(segment), false, true)
  }
  return expr
}

export const createDynamicValueExpression = (
  identifier: UIDLDynamicReference | UIDLGlobalReference,
  options: JSXGenerationOptions,
  t = types
) => {
  const inner = createDynamicValueExpressionRaw(identifier, options, t)

  // When the UIDL content carries a `valueMapper`, wrap the resolved
  // expression in a sandboxed IIFE that runs the user's `mapValue(value)`
  // and falls back to the raw value on error. This mirrors the state
  // definition `wrapWithMappingFunction` pattern and lets any framework
  // that re-uses `createDynamicValueExpression` inherit the behaviour.
  const valueMapper = (identifier.content as { valueMapper?: string }).valueMapper?.trim() || ''
  if (!valueMapper) {
    return inner
  }
  return wrapExpressionWithValueMapperAst(inner, valueMapper, t)
}

const wrapExpressionWithValueMapperAst = (
  innerExpression: types.Expression,
  valueMapper: string,
  t = types
): types.Expression => {
  // Build: ((v) => { try { return (new Function('value', '"use strict"; <mapper>; return mapValue(value);')).call(null, v) } catch (_e) { return v } })(<inner>)
  //
  // We deliberately use `new Function(...)` at runtime rather than parsing
  // the mapper body into AST statements here. That keeps this plugin free
  // of a parser dependency, matches the sandboxing used by state-definition
  // `wrapWithMappingFunction`, and ensures the generated code is framework
  // agnostic — only stringify semantics + `toString()` on primitives are
  // required for the output to render correctly.
  const tryBlock = t.tryStatement(
    t.blockStatement([
      t.returnStatement(
        t.callExpression(
          t.memberExpression(
            t.newExpression(t.identifier('Function'), [
              t.stringLiteral('value'),
              t.stringLiteral(`"use strict"; ${valueMapper}; return mapValue(value);`),
            ]),
            t.identifier('call')
          ),
          [t.nullLiteral(), t.identifier('v')]
        )
      ),
    ]),
    t.catchClause(t.identifier('_e'), t.blockStatement([t.returnStatement(t.identifier('v'))]))
  )
  const arrow = t.arrowFunctionExpression([t.identifier('v')], t.blockStatement([tryBlock]))
  return t.callExpression(arrow, [innerExpression])
}

const createDynamicValueExpressionRaw = (
  identifier: UIDLDynamicReference | UIDLGlobalReference,
  options: JSXGenerationOptions,
  t = types
) => {
  const identifierContent = identifier.content
  const refPath = identifier.content.refPath || []
  const { referenceType, id } = identifierContent

  if (referenceType === 'attr' || referenceType === 'children' || referenceType === 'token') {
    throw new Error(`Dynamic reference type "${referenceType}" is not supported yet`)
  }

  // 'ctx' references resolve to the data source context render prop identifier
  // using only the refPath to build property access
  if (referenceType === 'ctx') {
    const ctxPrefix = (options.dynamicReferencePrefixMap as Record<string, string>).ctx || ''
    if (ctxPrefix && refPath.length > 0) {
      let expr: types.Expression = t.identifier(ctxPrefix)
      for (const path of refPath) {
        expr = t.optionalMemberExpression(expr, t.identifier(path), false, true)
      }
      return expr
    }
    // Details-page fallback: an unresolvable `ctx` reference on a details page
    // (its ctxId points at no known render-prop context — e.g. a synthetic
    // `details-page-generic-*` id produced for a widget's `target`) is still a
    // column on the fetched row exposed as a prop. Resolve it exactly like the
    // `local` branch below → `props.<exposeAs>.<refPath>` (e.g.
    // `props.webinar?.scheduled_at`), so the widget binds the real value.
    if (options.detailsPageExposeAsName && refPath.length > 0) {
      const propPrefix =
        (options.dynamicReferencePrefixMap as Record<string, string>).prop || 'props'
      let expr: types.Expression = t.memberExpression(
        t.identifier(propPrefix),
        t.identifier(options.detailsPageExposeAsName)
      )
      for (const path of refPath) {
        expr = t.optionalMemberExpression(expr, t.identifier(path), false, true)
      }
      return expr
    }
    // Last resort: NEVER emit a bare identifier for an unresolved ctx reference —
    // `generateIdWithRefPath(id, …)` yields an UNDECLARED variable (e.g.
    // `tQQGFGA6h4I`), which throws `ReferenceError` during SSR and crashes the
    // Vercel `next build` export (run 1b6eb5ba: `/webinar-detail/[id]`). Emit the
    // reference's declared `fallbackValue` literal, or `undefined`.
    const ctxFallbackValue = (identifierContent as { fallbackValue?: unknown }).fallbackValue
    if (
      typeof ctxFallbackValue === 'string' ||
      typeof ctxFallbackValue === 'number' ||
      typeof ctxFallbackValue === 'boolean'
    ) {
      return convertValueToLiteral(ctxFallbackValue)
    }
    return t.identifier('undefined')
  }

  // `urlSearchParams` references read a declared key from the URL query string.
  // Next.js generators typically set `dynamicReferencePrefixMap.urlSearchParams`
  // to `'router.query'` so we emit `router.query.<key>`. Static / HTML
  // generators set it to `'__urlSearchParams'` and inject a `const
  // __urlSearchParams = new URLSearchParams(location.search)` prelude.
  //
  // `options.urlSearchParamsRegistry` (set by the plugin based on the page
  // UIDL's `searchParams` definition) supplies per-key defaults so we emit
  // `(router.query.category ?? 'food')` with the declared fallback.
  if (referenceType === 'urlSearchParams') {
    const paramKey = refPath[0] || id
    const urlParamsPrefix =
      (options.dynamicReferencePrefixMap as Record<string, string | undefined>).urlSearchParams ||
      'router.query'
    const [rootPrefix, ...restPath] = urlParamsPrefix.split('.')
    let expr: types.Expression = t.identifier(rootPrefix)
    for (const segment of restPath) {
      expr = t.memberExpression(expr, t.identifier(segment))
    }
    expr = t.optionalMemberExpression(expr, t.identifier(paramKey), false, true)
    const registry = (options as Record<string, unknown>).urlSearchParamsRegistry as
      | Record<string, { defaultValue?: string }>
      | undefined
    const declaredDefault = registry?.[paramKey]?.defaultValue
    if (declaredDefault !== undefined && declaredDefault !== '') {
      expr = t.logicalExpression('??', expr, t.stringLiteral(declaredDefault))
    }
    return expr
  }

  // 'local' references resolve to the iteration variable of the enclosing repeater.
  // The reference id in UIDL is a node id (e.g. "TQ_xxxxxx") and carries no meaning
  // at runtime — the only load-bearing pieces are the refPath and the current
  // localIdentifier (set when walking into a repeater/data-provider's children).
  if (referenceType === 'local') {
    const localPrefix =
      options.localIdentifier ||
      (options.dynamicReferencePrefixMap as Record<string, string>).local ||
      ''
    if (localPrefix) {
      if (refPath.length === 0) {
        return t.identifier(localPrefix)
      }
      let expr: types.Expression = t.identifier(localPrefix)
      for (const path of refPath) {
        expr = t.optionalMemberExpression(expr, t.identifier(path), false, true)
      }
      return expr
    }

    // Details-page fallback: a page-root `local` reference (no enclosing
    // repeater) means "a column on the fetched row" exposed as a prop under
    // `initialPropsData.exposeAs.name`. Resolve to `props.<name>.<refPath>`.
    if (options.detailsPageExposeAsName && refPath.length > 0) {
      const propPrefix =
        (options.dynamicReferencePrefixMap as Record<string, string>).prop || 'props'
      let expr: types.Expression = t.memberExpression(
        t.identifier(propPrefix),
        t.identifier(options.detailsPageExposeAsName)
      )
      for (const path of refPath) {
        expr = t.optionalMemberExpression(expr, t.identifier(path), false, true)
      }
      return expr
    }
  }

  const idWithPath = generateIdWithRefPath(id, refPath)

  const prefix =
    options.dynamicReferencePrefixMap[referenceType as 'prop' | 'state' | 'local'] || ''

  return prefix === ''
    ? t.identifier(idWithPath)
    : t.memberExpression(t.identifier(prefix), t.identifier(idWithPath))
}

// Prepares an identifier (from props or state or an expr) to be used as a conditional rendering identifier
// Assumes the type from the corresponding props/state definitions if not expr. Expressions are expected to have a boolean return here
export const createConditionIdentifier = (
  dynamicReference: UIDLDynamicReference | UIDLExpressionValue,
  params: JSXGenerationParams,
  options: JSXGenerationOptions
): ConditionalIdentifier => {
  if (dynamicReference.type === 'expr') {
    return {
      key: dynamicReference.content,
      type: 'boolean',
    }
  }

  const { id, referenceType, refPath } = dynamicReference.content

  // Handle local references (from repeaters/loops) - they don't have an id
  if (referenceType === 'local') {
    // For local references, the identifier comes from the refPath
    const refPathKey = refPath && refPath.length > 0 ? refPath.join('.') : ''
    const prefix = options.localIdentifier || ''

    // Details-page fallback: at the page root there is no enclosing repeater,
    // so a `local` reference means "a column on the fetched row" exposed as a
    // prop under `initialPropsData.exposeAs.name`.
    if (!prefix && options.detailsPageExposeAsName && refPathKey) {
      const propPrefix =
        (options.dynamicReferencePrefixMap as Record<string, string> | undefined)?.prop || 'props'
      return {
        key: `${options.detailsPageExposeAsName}.${refPathKey}`,
        type: 'string',
        prefix: propPrefix,
      }
    }

    return {
      key: refPathKey,
      type: 'string', // Default to string, actual type will be determined at runtime
      prefix,
    }
  }

  if (referenceType === 'global') {
    return {
      key: UIDLUtils.generateIdWithRefPath(id, refPath),
      type: 'string',
      prefix: '',
      referenceType: 'global',
    }
  }

  if ((referenceType as string) === 'globalState') {
    const resolvedName = resolveGlobalStateName(id, params.globalStateDefinitions)
    const refPathSegments = refPath || []
    const key =
      refPathSegments.length > 0
        ? refPathSegments.reduce((acc, seg) => `${acc}?.${seg}`, resolvedName)
        : resolvedName

    return {
      key,
      type: 'string',
      prefix: '',
      referenceType: 'globalState',
    }
  }

  // in case the id is a member expression: eg: fields.name
  const referenceRoot = id.split('.')[0]
  const currentType =
    referenceType === 'prop'
      ? params.propDefinitions[referenceRoot]?.type
      : params.stateDefinitions[referenceRoot]?.type

  let type = currentType
  if (refPath?.length) {
    if (referenceType === 'prop' && params.propDefinitions[referenceRoot]?.defaultValue) {
      let currentValue = params.propDefinitions[referenceRoot].defaultValue as Record<
        string,
        unknown
      >
      for (const path of refPath) {
        currentValue = currentValue?.[path] as Record<string, unknown>
        type = currentValue ? typeof currentValue : currentType
      }
    } else if (referenceType === 'state' && currentType === 'object') {
      const stateDef = params.stateDefinitions[referenceRoot]
      if (
        stateDef &&
        typeof stateDef.defaultValue === 'object' &&
        stateDef.defaultValue !== null &&
        !Array.isArray(stateDef.defaultValue)
      ) {
        const objectDefault = stateDef.defaultValue as Record<
          string,
          { type?: string; content?: unknown }
        >
        const entry = objectDefault[refPath[0]]
        if (entry?.type === 'static' && entry.content !== undefined) {
          type = typeof entry.content
        } else {
          type = 'string'
        }
      }
    }
  }

  switch (referenceType) {
    case 'prop':
      return {
        key: UIDLUtils.generateIdWithRefPath(id, refPath),
        type,
        prefix: options.dynamicReferencePrefixMap.prop,
      }
    case 'state':
      return {
        key: UIDLUtils.generateIdWithRefPath(id, refPath),
        type,
        prefix: options.dynamicReferencePrefixMap.state,
      }

    case 'expr':
      return {
        key: id,
        type: 'boolean',
      }

    default:
      throw new Error(
        `createConditionIdentifier encountered an invalid reference type: ${JSON.stringify(
          dynamicReference,
          null,
          2
        )}`
      )
  }
}

export const createConditionalJSXExpression = (
  content: JSXASTReturnType,
  conditionalExpression: UIDLConditionalExpression,
  conditionalIdentifier: ConditionalIdentifier,
  options: { localIdentifier?: string; detailsPageExposeAsName?: string } = {},
  t = types
) => {
  let contentNode: types.Expression

  if (typeof content === 'string') {
    contentNode = t.stringLiteral(content)
  } else if (content.type === 'JSXExpressionContainer') {
    contentNode = content.expression as types.Expression
  } else {
    contentNode = content
  }

  let binaryExpression:
    | types.LogicalExpression
    | types.BinaryExpression
    | types.UnaryExpression
    | types.Identifier
    | types.MemberExpression
    | types.CallExpression

  // When the stateValue is an object we will compute a logical/binary expression on the left side
  const { conditions, matchingCriteria } = conditionalExpression
  const binaryExpressions = conditions.map((condition) =>
    createBinaryExpression(condition, conditionalIdentifier, options)
  )

  if (binaryExpressions.length === 1) {
    binaryExpression = binaryExpressions[0]
  } else {
    // the first two binary expressions are put together as a logical expression
    const [firstExp, secondExp] = binaryExpressions
    const operation = matchingCriteria === 'all' ? '&&' : '||'
    let expression: types.LogicalExpression = t.logicalExpression(operation, firstExp, secondExp)

    // accumulate the rest of the expressions to the logical expression
    for (let index = 2; index < binaryExpressions.length; index++) {
      expression = t.logicalExpression(operation, expression, binaryExpressions[index])
    }

    binaryExpression = expression
  }

  return t.logicalExpression('&&', binaryExpression, contentNode)
}

/**
 * Resolves an operand value to an AST expression, handling dynamic refs, expressions, and static values.
 */
const resolveOperandExpression = (
  operand: string | number | boolean | UIDLDynamicReference | UIDLExpressionValue,
  conditionalIdentifier: ConditionalIdentifier,
  options: { localIdentifier?: string; detailsPageExposeAsName?: string }
): types.Expression => {
  if (typeof operand === 'object' && 'type' in operand && operand.type === 'expr') {
    return getExpressionFromUIDLExpressionNode(operand)
  }

  if (typeof operand === 'object' && 'type' in operand && operand.type === 'dynamic') {
    return createDynamicValueExpression(operand, {
      dynamicReferencePrefixMap: {
        prop: 'props',
        state: '',
        local: '',
      },
      localIdentifier: options.localIdentifier,
      detailsPageExposeAsName: options.detailsPageExposeAsName,
    })
  }

  return convertValueToLiteral(operand, conditionalIdentifier.type)
}

export const createBinaryExpression = (
  condition: {
    operation: string
    operand?: string | number | boolean | UIDLDynamicReference | UIDLExpressionValue
    containsField?: string
  },
  conditionalIdentifier: ConditionalIdentifier,
  options: { localIdentifier?: string; detailsPageExposeAsName?: string } = {},
  t = types
) => {
  const { operand, operation, containsField } = condition
  const identifier = conditionalIdentifier.prefix
    ? t.memberExpression(
        t.identifier(conditionalIdentifier.prefix),
        t.identifier(conditionalIdentifier.key)
      )
    : t.identifier(conditionalIdentifier.key)

  // Array/Object operators
  if (operation === 'isEmpty') {
    // For objects, use Object.keys(x).length; for arrays (or unknown), use x.length
    const lengthExpr =
      conditionalIdentifier.type === 'object'
        ? t.memberExpression(
            t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('keys')), [
              identifier,
            ]),
            t.identifier('length')
          )
        : t.memberExpression(identifier, t.identifier('length'))
    return t.binaryExpression('===', lengthExpr, t.numericLiteral(0))
  }

  if (operation === 'isNotEmpty') {
    const lengthExpr =
      conditionalIdentifier.type === 'object'
        ? t.memberExpression(
            t.callExpression(t.memberExpression(t.identifier('Object'), t.identifier('keys')), [
              identifier,
            ]),
            t.identifier('length')
          )
        : t.memberExpression(identifier, t.identifier('length'))
    return t.binaryExpression('>', lengthExpr, t.numericLiteral(0))
  }

  if (operation === 'lengthEquals' && operand !== undefined) {
    return t.binaryExpression(
      '===',
      t.memberExpression(identifier, t.identifier('length')),
      resolveOperandExpression(operand, conditionalIdentifier, options)
    )
  }

  if (operation === 'lengthGreaterThan' && operand !== undefined) {
    return t.binaryExpression(
      '>',
      t.memberExpression(identifier, t.identifier('length')),
      resolveOperandExpression(operand, conditionalIdentifier, options)
    )
  }

  if (operation === 'lengthLessThan' && operand !== undefined) {
    return t.binaryExpression(
      '<',
      t.memberExpression(identifier, t.identifier('length')),
      resolveOperandExpression(operand, conditionalIdentifier, options)
    )
  }

  if (operation === 'contains' && operand !== undefined) {
    const operandExpr = resolveOperandExpression(operand, conditionalIdentifier, options)

    if (containsField) {
      const itemParam = t.identifier('__item')
      return t.callExpression(t.memberExpression(identifier, t.identifier('some')), [
        t.arrowFunctionExpression(
          [itemParam],
          t.binaryExpression(
            '===',
            t.memberExpression(itemParam, t.identifier(containsField)),
            operandExpr
          )
        ),
      ])
    }

    return t.callExpression(t.memberExpression(identifier, t.identifier('includes')), [operandExpr])
  }

  if (operation === 'notContains' && operand !== undefined) {
    const operandExpr = resolveOperandExpression(operand, conditionalIdentifier, options)

    if (containsField) {
      const itemParam = t.identifier('__item')
      return t.unaryExpression(
        '!',
        t.callExpression(t.memberExpression(identifier, t.identifier('some')), [
          t.arrowFunctionExpression(
            [itemParam],
            t.binaryExpression(
              '===',
              t.memberExpression(itemParam, t.identifier(containsField)),
              operandExpr
            )
          ),
        ])
      )
    }

    return t.unaryExpression(
      '!',
      t.callExpression(t.memberExpression(identifier, t.identifier('includes')), [operandExpr])
    )
  }

  if (operation === 'hasKey' && operand !== undefined) {
    const operandExpr = resolveOperandExpression(operand, conditionalIdentifier, options)
    return t.callExpression(
      t.memberExpression(
        t.memberExpression(
          t.memberExpression(t.identifier('Object'), t.identifier('prototype')),
          t.identifier('hasOwnProperty')
        ),
        t.identifier('call')
      ),
      [identifier, operandExpr]
    )
  }

  if (operation === 'notHasKey' && operand !== undefined) {
    const operandExpr = resolveOperandExpression(operand, conditionalIdentifier, options)
    return t.unaryExpression(
      '!',
      t.callExpression(
        t.memberExpression(
          t.memberExpression(
            t.memberExpression(t.identifier('Object'), t.identifier('prototype')),
            t.identifier('hasOwnProperty')
          ),
          t.identifier('call')
        ),
        [identifier, operandExpr]
      )
    )
  }

  // Standard binary operators
  if (operation === '===') {
    if (operand === true) {
      return identifier
    }

    if (operand === false) {
      return t.unaryExpression('!', identifier)
    }
  }

  if (operand !== undefined) {
    if (typeof operand === 'object' && 'type' in operand && operand.type === 'expr') {
      const exprIdentifier = getExpressionFromUIDLExpressionNode(operand)

      return t.binaryExpression(convertToBinaryOperator(operation), identifier, exprIdentifier)
    }

    if (typeof operand === 'object' && 'type' in operand && operand.type === 'dynamic') {
      const dynamicValueIdentifier = createDynamicValueExpression(operand, {
        dynamicReferencePrefixMap: {
          prop: 'props',
          state: '',
          local: '',
        },
        localIdentifier: options.localIdentifier,
      })

      return t.binaryExpression(
        convertToBinaryOperator(operation),
        identifier,
        dynamicValueIdentifier
      )
    }

    const stateValueIdentifier = convertValueToLiteral(operand, conditionalIdentifier.type)

    const lhs =
      (conditionalIdentifier.referenceType === 'global' ||
        conditionalIdentifier.referenceType === 'globalState') &&
      typeof operand === 'string'
        ? t.optionalCallExpression(
            t.optionalMemberExpression(identifier, t.identifier('toString'), false, true),
            [],
            false
          )
        : identifier

    return t.binaryExpression(convertToBinaryOperator(operation), lhs, stateValueIdentifier)
  } else {
    return operation ? t.unaryExpression(convertToUnaryOperator(operation), identifier) : identifier
  }
}

export const getRepeatSourceIdentifier = (
  dataSource: UIDLAttributeValue,
  options: JSXGenerationOptions
) => {
  switch (dataSource.type) {
    case 'static':
      return convertValueToLiteral(dataSource.content)
    case 'dynamic': {
      return createDynamicValueExpression(dataSource, options)
    }
    default:
      throw new Error(`Invalid type for dataSource: ${dataSource}`)
  }
}
