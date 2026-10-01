import { UIDLStateDefinition } from '@teleporthq/teleport-types'
import { findFormStateKeyForHydration } from '../src/admin-form-hydration'

const objectState = (defaultValue: Record<string, unknown>): UIDLStateDefinition => ({
  type: 'object',
  defaultValue,
})

describe('findFormStateKeyForHydration', () => {
  it('copies the loaded row into the selected-item form, whatever order the states arrive in', () => {
    // The editor stores a page's states by id, so the product update page's
    // options editor states can come before its form.
    const states: Record<string, UIDLStateDefinition> = {
      productsUpdateOptionsPriceBy: objectState({ mode: 'fixed', open: 'false' }),
      productsUpdateOptionsMeta: objectState({ isEmpty: 'false' }),
      productsSelectedItemData: objectState({ name: '', price: '' }),
      productsSelectedItemId: { type: 'string', defaultValue: '' },
      productsUpdateOptionsEdit: objectState({ label: '' }),
    }
    expect(findFormStateKeyForHydration(states)).toBe('productsSelectedItemData')
  })

  it('keeps the only object state of a page without a selected-item form', () => {
    const states: Record<string, UIDLStateDefinition> = {
      isOpen: { type: 'boolean', defaultValue: false },
      initialAccountFormData: objectState({ first_name: '' }),
    }
    expect(findFormStateKeyForHydration(states)).toBe('initialAccountFormData')
  })

  it('never picks an empty object, an array or a missing state', () => {
    expect(
      findFormStateKeyForHydration({
        rows: { type: 'array', defaultValue: [] },
        emptyObject: objectState({}),
      })
    ).toBeUndefined()
  })
})
