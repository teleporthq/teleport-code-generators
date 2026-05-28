// Shared body for the state-get-{global,local}-state handlers.
//
// Both nodes share the same logic — read the state slot named by
// `config.property` from the runtime's `__stateValues` map and return it as
// `{ value, key }`. Splitting this out keeps the two handler files in
// lockstep (same emit, same shape) and avoids the trap where one is updated
// to expose a new field while the other silently doesn't.
//
// The `key` field exposes the property name back to downstream nodes — the
// workflow editor advertises it as a bindable field per the schema, so refs
// like `{ type: 'workflowContext', path: [<state-get-id>, 'key'] }` must
// resolve to the original config value the user typed (not a normalised
// camelCase variant; see workflow-utils.ts in teleport-gui).
//
// We assemble the body via plain string concatenation so callers can
// substitute the symbol name (state_get_global_state vs state_get_local_state)
// without backtick interpolation hazards — the rate-limiter file already
// taught us that backticks inside emitted handler strings can break codegen
// downstream when those strings are themselves embedded in template literals.

const STATE_GET_BODY = [
  '  const stateValues = (context && context.__stateValues) || {};',
  '  return { value: stateValues[config.property], key: config.property };',
].join('\n')

/**
 * Build the source string for a state-get handler. The returned string is a
 * stand-alone async function declaration that `handlerToString` callers can
 * embed directly, matching the convention used by every other handler in the
 * registry.
 */
export const buildStateGetHandlerSource = (symbolName: string): string => {
  return 'async function ' + symbolName + '(config, context) {\n' + STATE_GET_BODY + '\n}'
}
