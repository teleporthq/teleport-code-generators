import generate from '@babel/generator'
import * as types from '@babel/types'
import { component, elementNode } from '@teleporthq/teleport-uidl-builders'
import {
  ChunkType,
  ComponentStructure,
  FileType,
  UIDLReferencedStyles,
} from '@teleporthq/teleport-types'
import { createReactStyledJSXPlugin } from '../src'

// A conditionally-bound class can read a global state, or a built-in global,
// on either side of its condition. Whichever side reads it, the class test has
// to name the binding the component declares, and the component has to be told
// to declare it.

const SELECTED_ID = 'f3a1c2d4-selected'
const PROFILE_ID = 'b7e9d0a2-profile'

const globalStateDefinitions = {
  [SELECTED_ID]: { id: SELECTED_ID, name: 'selectedLook', type: 'string', defaultValue: '' },
  [PROFILE_ID]: { id: PROFILE_ID, name: 'profile', type: 'object', defaultValue: {} },
}

const globalState = (id: string, refPath?: string[]) => ({
  type: 'dynamic',
  content: { referenceType: 'globalState', id, ...(refPath ? { refPath } : {}) },
})
const propReference = { type: 'dynamic', content: { referenceType: 'prop', id: 'look' } }

const classWhen = (reference: unknown, operand: unknown) =>
  ({
    active: {
      type: 'style-map',
      content: {
        mapType: 'project-referenced',
        referenceId: 'btn-active',
        condition: { reference, expression: { conditions: [{ operation: '===', operand }] } },
      },
    },
  } as unknown as UIDLReferencedStyles)

const generateClassName = async (referencedStyles: UIDLReferencedStyles) => {
  const button = types.jsxElement(
    types.jsxOpeningElement(types.jsxIdentifier('button'), []),
    types.jsxClosingElement(types.jsxIdentifier('button')),
    []
  )
  const uidl = component(
    'ActionButton',
    elementNode('button', {}, [], null, null, null, referencedStyles),
    { look: { type: 'string', defaultValue: 'primary' } }
  )
  uidl.node.content.key = 'button'
  const globalStateReferences: Array<{ id: string; name: string }> = []
  const globalReferences: string[] = []
  const structure = {
    uidl,
    chunks: [
      {
        name: 'jsx-component',
        type: ChunkType.AST,
        fileType: FileType.JS,
        linkAfter: [],
        content: {},
        meta: {
          nodesLookup: { button },
          dynamicRefPrefix: { prop: 'props' },
          globalStateReferences,
          globalReferences,
        },
      },
    ],
    dependencies: {},
    options: {
      projectStyleSet: {
        styleSetDefinitions: { 'btn-active': { type: 'reusable-project-style-map', content: {} } },
        fileName: 'style',
        path: '',
      },
      globalStateDefinitions,
    },
  } as unknown as ComponentStructure

  await createReactStyledJSXPlugin()(structure)

  const classAttribute = button.openingElement.attributes.find(
    (attribute) => attribute.type === 'JSXAttribute' && attribute.name.name === 'className'
  ) as types.JSXAttribute
  const value = classAttribute.value as types.JSXExpressionContainer
  return { code: generate(value.expression).code, globalStateReferences, globalReferences }
}

describe('a conditional class that reads a global state', () => {
  it('compares a prop against the state by its declared name and registers it', async () => {
    const { code, globalStateReferences } = await generateClassName(
      classWhen(propReference, globalState(SELECTED_ID))
    )

    expect(code).toContain('props?.look === selectedLook ?')
    expect(code).not.toContain(SELECTED_ID)
    expect(globalStateReferences).toEqual([{ id: SELECTED_ID, name: 'selectedLook' }])
  })

  it('follows a field path into an object state on the right side', async () => {
    const { code, globalStateReferences } = await generateClassName(
      classWhen(propReference, globalState(PROFILE_ID, ['theme', 'look']))
    )

    expect(code).toContain('props?.look === profile?.theme?.look ?')
    expect(globalStateReferences).toEqual([{ id: PROFILE_ID, name: 'profile' }])
  })

  it('registers a state read on the left side, and both of a state against a state', async () => {
    const { code, globalStateReferences } = await generateClassName(
      classWhen(globalState(SELECTED_ID), globalState(PROFILE_ID, ['look']))
    )

    expect(code).toContain('selectedLook === profile?.look ?')
    expect(globalStateReferences).toEqual([
      { id: SELECTED_ID, name: 'selectedLook' },
      { id: PROFILE_ID, name: 'profile' },
    ])
  })

  it('registers a state read on the left side against a literal', async () => {
    const { code, globalStateReferences } = await generateClassName(
      classWhen(globalState(SELECTED_ID), 'primary')
    )

    expect(code).toContain('selectedLook === "primary" ?')
    expect(globalStateReferences).toEqual([{ id: SELECTED_ID, name: 'selectedLook' }])
  })
})

describe('a conditional class whose right side is a built-in global', () => {
  it('registers a global named by its runtime identifier', async () => {
    const { code, globalReferences } = await generateClassName(
      classWhen(propReference, {
        type: 'dynamic',
        content: { referenceType: 'global', id: 'currentUser', refPath: ['role'] },
      })
    )

    expect(code).toContain("props?.look === currentUser?.['role'] ?")
    expect(globalReferences).toEqual(['currentUser'])
  })

  it('derives the runtime identifier of a global named only by its display path', async () => {
    const { code, globalReferences } = await generateClassName(
      classWhen(propReference, {
        type: 'dynamic',
        content: { referenceType: 'global', id: 'TQ_opaque', refPath: ['Current User', 'role'] },
      })
    )

    expect(code).toContain("props?.look === currentUser?.['role'] ?")
    expect(code).not.toContain('TQ_opaque')
    expect(globalReferences).toEqual(['currentUser'])
  })
})
