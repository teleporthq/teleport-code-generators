import { NodeHandlerGenerator, handlerToString } from '../types'

// The handler below ships verbatim into both the server and client runtimes
// (executionEnv: 'universal'), so it must:
//   - run unchanged in Node and the browser
//   - produce the params / innerParams arrays the workflow editor advertises
//     (see workflow-utils.ts in teleport-gui and the CLAUDE.md non-negotiables)
//   - stay backwards compatible for top-level custom-js, which historically
//     received a flat `params` of every preceding node output in step order
//
// Argument-binding contract enforced here, derived from the workflow editor:
//   top-level, no loop:           customHandler(params)
//   inside custom node:           customHandler(previousContext, params)
//   inside N loops:               customHandler(params, innerParams[, innerParams2 ...])
//   custom node + N loops:        customHandler(previousContext, params, innerParams[, ...])
//
// `params` always means "workflow-level predecessors" — at top level that is
// every preceding context entry; inside a loop body that is only the entries
// outside every active loop scope. Loop-body predecessors land in
// `innerParams` (innermost first). The handler discovers active loops via
// `context.__loopScopeStack`, which the runtime pushes/pops around every
// loop body.
async function general_custom_js(config: any, context: Record<string, unknown>) {
  const code = config.code

  // Reserved context keys that must never leak into params / innerParams.
  // Anything starting with "__" is internal scaffolding; these named entries
  // are existing well-known runtime keys.
  const RESERVED: Record<string, true> = {
    triggerElement: true,
    __stateValues: true,
    __previousNodeResult: true,
    __isInsideCustomNode: true,
    __customNodeIds: true,
    __customParams: true,
    __baseUrl: true,
    __skippedNodes: true,
    __loopBodyNodeIds: true,
    __loopScopeStack: true,
    __loopNodeIds: true,
    __request: true,
    __loopItem: true,
    __loopIndex: true,
    __nodeId: true,
  }

  const isReservedKey = (k: string): boolean => {
    if (RESERVED[k]) {
      return true
    }
    if (k.length >= 2 && k.charAt(0) === '_' && k.charAt(1) === '_') {
      return true
    }
    // executor-generator (client runtime) stashes per-iteration loop state
    // under "<loopId>_iter". Skip it so it never appears as a param.
    if (k.length > 5 && k.lastIndexOf('_iter') === k.length - 5) {
      return true
    }
    return false
  }

  const isInsideCustomNode = !!(context as any).__isInsideCustomNode
  const customNodeIds: string[] = (context as any).__customNodeIds || []
  const loopScopeStack: Array<{
    loopNodeId: string
    bodyNodeIds: Record<string, true>
  }> = (context as any).__loopScopeStack || []

  const currentNodeId: string | undefined = config && config.__nodeId

  // Sets of node ids that are part of any active loop scope. We need both
  // the loop scaffold ids (the loop node itself) and the body ids so they
  // can be filtered out of `params`. We also seed allLoopScaffoldIds with
  // every loop id the runtime has ever entered (context.__loopNodeIds), so
  // a sibling node sitting outside an already-completed inner loop doesn't
  // suddenly see that inner loop's scaffold value in its innerParams.
  const allLoopScaffoldIds: Record<string, true> = {}
  const allLoopBodyIds: Record<string, true> = {}
  const knownLoopNodeIds: Record<string, true> = (context as any).__loopNodeIds || {}
  const knownKeys = Object.keys(knownLoopNodeIds)
  for (let kk = 0; kk < knownKeys.length; kk++) {
    if (knownLoopNodeIds[knownKeys[kk]]) {
      allLoopScaffoldIds[knownKeys[kk]] = true
    }
  }
  for (let si = 0; si < loopScopeStack.length; si++) {
    const scope = loopScopeStack[si]
    if (scope && scope.loopNodeId) {
      allLoopScaffoldIds[scope.loopNodeId] = true
    }
    if (scope && scope.bodyNodeIds) {
      const bIds = scope.bodyNodeIds
      const bKeys = Object.keys(bIds)
      for (let bk = 0; bk < bKeys.length; bk++) {
        if (bIds[bKeys[bk]]) {
          allLoopBodyIds[bKeys[bk]] = true
        }
      }
    }
  }

  // ---- previousContext ----
  // Inside a custom node we always honour __previousNodeResult so the parent
  // workflow's previous output is available. At top level we mirror the
  // legacy fallback: previousNodeResult if present, else the first non-
  // reserved context entry (typically the trigger).
  const prevResult = (context as any).__previousNodeResult
  let previousContext: unknown
  if (isInsideCustomNode) {
    previousContext = prevResult !== null && prevResult !== undefined ? prevResult : {}
  } else if (prevResult !== null && prevResult !== undefined) {
    previousContext = prevResult
  } else {
    const ctxKeys = Object.keys(context).filter((k) => !isReservedKey(k))
    previousContext =
      ctxKeys.length > 0
        ? (context as any)[ctxKeys[0]]
        : { element: (context as any).triggerElement }
  }

  // ---- params ----
  // Inside a custom node, params are the custom node's internal nodes by
  // their position. We also overlay __customParams onto the array so user
  // code can read `params.productId` etc. For nested loops inside the custom
  // node, body-scoped ids drop out of params (they belong to innerParams).
  // At top level, params iterates the live context in insertion order, which
  // matches the workflow's predecessor order because nodes are executed in
  // step order.
  let params: any
  if (isInsideCustomNode) {
    const list: any[] = []
    for (let i = 0; i < customNodeIds.length; i++) {
      const id = customNodeIds[i]
      if (allLoopScaffoldIds[id]) {
        continue
      }
      if (allLoopBodyIds[id]) {
        continue
      }
      if (id === currentNodeId) {
        continue
      }
      list.push((context as any)[id])
    }
    const customParams = (context as any).__customParams
    if (customParams) {
      if (Array.isArray(customParams)) {
        for (let cp = 0; cp < customParams.length; cp++) {
          const entry = customParams[cp]
          if (entry && entry.key !== undefined) {
            ;(list as any)[entry.key] = entry.value
          }
        }
      } else if (typeof customParams === 'object') {
        const cpKeys = Object.keys(customParams)
        for (let cp = 0; cp < cpKeys.length; cp++) {
          ;(list as any)[cpKeys[cp]] = customParams[cpKeys[cp]]
        }
      }
    }
    params = list
  } else {
    const list: any[] = []
    const keys = Object.keys(context)
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      if (isReservedKey(k)) {
        continue
      }
      if (allLoopScaffoldIds[k]) {
        continue
      }
      if (allLoopBodyIds[k]) {
        continue
      }
      if (k === currentNodeId) {
        continue
      }
      list.push((context as any)[k])
    }
    const resolvedNamedParams = (config as any).params
    if (
      resolvedNamedParams &&
      typeof resolvedNamedParams === 'object' &&
      !Array.isArray(resolvedNamedParams) &&
      Object.keys(resolvedNamedParams).length > 0
    ) {
      list.push(resolvedNamedParams)
    }
    params = list
  }

  // ---- innerParams[i] ----
  // For each active loop scope (innermost first), collect the context entries
  // that belong to that scope's body but NOT to any deeper-nested scope's
  // body. This gives clean per-level separation matching the workflow editor
  // semantics (`innerParams` = direct enclosing loop, `innerParams2` = next
  // outer, ...). The current node is excluded so a loop body's last node
  // doesn't see itself.
  const innerParamsList: any[][] = []
  const seenBody: Record<string, true> = {}
  for (let i = loopScopeStack.length - 1; i >= 0; i--) {
    const scope = loopScopeStack[i]
    const arr: any[] = []
    if (scope && scope.bodyNodeIds) {
      const ckeys = Object.keys(context)
      for (let ki = 0; ki < ckeys.length; ki++) {
        const k = ckeys[ki]
        if (!scope.bodyNodeIds[k]) {
          continue
        }
        if (seenBody[k]) {
          continue
        }
        if (k === currentNodeId) {
          continue
        }
        if (isReservedKey(k)) {
          continue
        }
        // Loop scaffolding nodes (the loops themselves) are technically
        // members of their parent loop's body, but the workflow editor
        // treats them as structural — never as "previous nodes" the user
        // can read. Drop them so innerParams stays a clean per-level slice.
        if (allLoopScaffoldIds[k]) {
          continue
        }
        arr.push((context as any)[k])
      }
      const bKeys = Object.keys(scope.bodyNodeIds)
      for (let bk = 0; bk < bKeys.length; bk++) {
        if (scope.bodyNodeIds[bKeys[bk]]) {
          seenBody[bKeys[bk]] = true
        }
      }
    }
    innerParamsList.push(arr)
  }

  // ---- bind to user-declared signature ----
  // Map declared arg names to their values so signatures with any subset /
  // ordering work. `argValues` keys mirror the names the workflow editor
  // generates: previousContext, params, innerParams, innerParams2, ...
  const argValues: Record<string, unknown> = {
    previousContext,
    params,
  }
  for (let i = 0; i < innerParamsList.length; i++) {
    const name = i === 0 ? 'innerParams' : 'innerParams' + (i + 1)
    argValues[name] = innerParamsList[i]
  }

  try {
    // Skip leading whitespace, line comments (`// …`) and block comments
    // (`/* … */`) before testing whether the user wrote a `function …`
    // declaration. Rewritten customHandlers prepend a `/* teleport:… */`
    // marker so detectors can find them without parsing; without this
    // step the original regex would miss the declaration and fall into
    // the script-body path, which never CALLS the declared function and
    // returns undefined.
    let codeStart = 0
    while (codeStart < code.length) {
      const ch = code.charCodeAt(codeStart)
      // whitespace: space(32) tab(9) lf(10) cr(13) vt(11) ff(12)
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 11 || ch === 12) {
        codeStart++
        continue
      }
      if (code[codeStart] === '/' && code[codeStart + 1] === '/') {
        codeStart += 2
        while (codeStart < code.length && code[codeStart] !== '\n') {
          codeStart++
        }
        continue
      }
      if (code[codeStart] === '/' && code[codeStart + 1] === '*') {
        codeStart += 2
        while (
          codeStart < code.length - 1 &&
          !(code[codeStart] === '*' && code[codeStart + 1] === '/')
        ) {
          codeStart++
        }
        codeStart += 2
        continue
      }
      break
    }
    // Prefer the documented entry point `function customHandler(...)` over
    // whatever declaration happens to appear first. The workflow editor
    // always emits the user's code as `function customHandler(...)`, but
    // helpers may be declared at the top level (e.g. `function helper(){…}
    // function customHandler(){…}`). Without this preference the runtime
    // would invoke the helper with the wrong arguments and crash.
    // Runtime preamble that shadows `process` for the duration of the
    // user-supplied JS execution. Protected platform secrets — the
    // names a deployed Teleport project may not leak — resolve to
    // `undefined` through this shadow even when the user goes through
    // `globalThis.process` or `Object.keys(process.env)`. This is a
    // defence-in-depth layer; static analysis at publish time already
    // rejects code that does any of this.
    //
    // The user code is wrapped in an IIFE that takes `process` and
    // `globalThis` as parameters. Doing it that way (instead of `var process
    // = ...` in the outer scope) avoids JS hoisting: a top-level `var
    // process` declaration would shadow the global at the FIRST line of
    // the function body, causing `typeof process !== "undefined"` to read
    // the hoisted `undefined` local instead of the real global.
    const SECURITY_PREAMBLE =
      'var __TQ_PROTECTED = {' +
      '"TELEPORT_DB_CONNECTION_STRING":1,' +
      '"RUNTIME_STORAGE_API_KEY":1,' +
      '"RUNTIME_STORAGE_PROJECT_ID":1,' +
      '"TELEPORT_PROJECT_TOKEN":1,' +
      '"REALTIME_SERVER_API_KEY":1,' +
      '"REALTIME_SERVER_URL":1,' +
      '"PDF_SERVICE_URL":1,' +
      '"PDF_SERVICE_API_KEY":1' +
      '};\n' +
      'var __TQ_origProcess = (typeof process !== "undefined") ? process : undefined;\n' +
      'var __TQ_origGlobalThis = (typeof globalThis !== "undefined") ? globalThis : (typeof global !== "undefined" ? global : undefined);\n' +
      'var __TQ_safeEnv = (__TQ_origProcess && __TQ_origProcess.env && typeof Proxy !== "undefined")' +
      ' ? new Proxy(__TQ_origProcess.env, {' +
      '  get: function(t,k){ return __TQ_PROTECTED[k] ? undefined : t[k]; },' +
      '  has: function(t,k){ return !__TQ_PROTECTED[k] && (k in t); },' +
      '  ownKeys: function(t){ return Object.keys(t).filter(function(k){ return !__TQ_PROTECTED[k]; }); },' +
      '  getOwnPropertyDescriptor: function(t,k){ return __TQ_PROTECTED[k] ? undefined : Object.getOwnPropertyDescriptor(t,k); }' +
      '}) : (__TQ_origProcess ? __TQ_origProcess.env : undefined);\n' +
      'var __TQ_safeProcess = __TQ_origProcess && typeof Proxy !== "undefined"' +
      ' ? new Proxy(__TQ_origProcess, { get: function(t,k){ return k === "env" ? __TQ_safeEnv : t[k]; } })' +
      ' : __TQ_origProcess;\n' +
      'var __TQ_safeGlobalThis = __TQ_origGlobalThis && typeof Proxy !== "undefined"' +
      ' ? new Proxy(__TQ_origGlobalThis, { get: function(t,k){ return k === "process" ? __TQ_safeProcess : t[k]; } })' +
      ' : __TQ_origGlobalThis;\n'

    const slice = code.slice(codeStart)
    const customHandlerMatch = slice.match(/function\s+customHandler\s*\(([^)]*)\)/)
    const fnMatch = customHandlerMatch
      ? (['', 'customHandler', customHandlerMatch[1]] as unknown as RegExpMatchArray)
      : slice.match(/^function\s+(\w+)\s*\(([^)]*)\)/)
    if (fnMatch) {
      const fnName = fnMatch[1]
      const declaredArgs: string[] = fnMatch[2]
        .split(',')
        .map((a: string) => a.trim())
        .filter(Boolean)
      // If the user declared no args, fall back to passing `params` so
      // legacy code that ignores arguments keeps working.
      const argNames = declaredArgs.length > 0 ? declaredArgs : ['params']
      // User code runs inside an IIFE so the safe `process` / `globalThis`
      // shadow are visible as locals without var-hoisting hazards. The
      // IIFE forwards the outer argument names through its own parameter
      // list so the user function still receives params / innerParamsN
      // exactly as before. We use TQ-prefixed param names then reassign
      // `process` / `globalThis` via `var` inside the IIFE so the user
      // can still safely declare a parameter named `process` in their
      // own customHandler signature without colliding with the wrapper.
      const iifeParams = ['__TQ_p', '__TQ_g'].concat(argNames).join(', ')
      const iifeArgs = ['__TQ_safeProcess', '__TQ_safeGlobalThis'].concat(argNames).join(', ')
      const execCode =
        SECURITY_PREAMBLE +
        'return (function(' +
        iifeParams +
        ') {\n' +
        'var process = __TQ_p;\n' +
        'var globalThis = __TQ_g;\n' +
        code +
        '\nreturn ' +
        fnName +
        '(' +
        argNames.join(', ') +
        ');\n})(' +
        iifeArgs +
        ');'
      // The legacy Function(parameterList, body) form takes a comma-separated
      // string of formal parameter names. We use it here so the handler's
      // compiled output stays free of helper-dependent spread syntax — the
      // generated runtime ships into both the server segment and the browser
      // bundle, where ts-jest's __spreadArray helper isn't available.
      const compiledUserFn = new Function(argNames.join(', '), execCode)
      const callValues: unknown[] = []
      for (let ai = 0; ai < argNames.length; ai++) {
        const name = argNames[ai]
        let value = argValues[name]
        // If the user declared `innerParams` (or innerParams2, ...) but the
        // node isn't actually inside enough loops to populate that level,
        // hand them `[]` instead of `undefined` so `innerParams[0]?.x`
        // gracefully resolves to undefined instead of throwing TypeError.
        if (value === undefined && name.indexOf('innerParams') === 0) {
          value = []
        }
        callValues.push(value)
      }
      let result = compiledUserFn.apply(null, callValues)
      if (result && typeof result.then === 'function') {
        result = await result
      }
      return result
    }

    // No function declaration: treat the code as a script body. Expose
    // params + previousContext as the documented top-level entry points.
    // User code runs inside an IIFE that captures the safe `process` /
    // `globalThis` shadow via local var reassignment (see SECURITY_PREAMBLE).
    const scriptBody =
      SECURITY_PREAMBLE +
      'return (function(__TQ_p, __TQ_g, params, previousContext) {\n' +
      'var process = __TQ_p;\n' +
      'var globalThis = __TQ_g;\n' +
      code +
      '\n})(__TQ_safeProcess, __TQ_safeGlobalThis, params, previousContext);'
    const scriptBodyFn = new Function('params', 'previousContext', scriptBody)
    let scriptResult = scriptBodyFn(argValues.params, argValues.previousContext)
    if (scriptResult && typeof scriptResult.then === 'function') {
      scriptResult = await scriptResult
    }
    return scriptResult
  } catch (err: unknown) {
    return { error: (err as Error).message }
  }
}

export const generalCustomJs: NodeHandlerGenerator = {
  nodeType: 'general-custom-js',
  executionEnv: 'universal',
  generateHandler(): string {
    return handlerToString(general_custom_js)
  },
}
