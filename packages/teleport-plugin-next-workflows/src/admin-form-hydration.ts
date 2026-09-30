import { UIDLStateDefinition } from '@teleporthq/teleport-types'

/** An admin update page keeps the row it loads in `<entity>SelectedItemData`. */
const SELECTED_ITEM_DATA_STATE = /SelectedItemData$/

const isFormDataState = (definition: UIDLStateDefinition | undefined): boolean =>
  !!definition &&
  definition.type === 'object' &&
  typeof definition.defaultValue === 'object' &&
  definition.defaultValue !== null &&
  !Array.isArray(definition.defaultValue) &&
  Object.keys(definition.defaultValue as Record<string, unknown>).length > 0

/**
 * The state a page's initial props are copied into on mount. The page's states
 * arrive in no particular order (the editor stores them by id), so an update
 * page with several object states — a form and an editor's view state — must
 * name its form: the `<entity>SelectedItemData` state wins, and a page without
 * one keeps its only (first) object state.
 */
export function findFormStateKeyForHydration(
  stateDefinitions: Record<string, UIDLStateDefinition>
): string | undefined {
  const candidates = Object.keys(stateDefinitions).filter((key) =>
    isFormDataState(stateDefinitions[key])
  )
  return candidates.find((key) => SELECTED_ITEM_DATA_STATE.test(key)) ?? candidates[0]
}
