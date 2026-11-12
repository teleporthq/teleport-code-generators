import * as types from '@babel/types'
import generate from '@babel/generator'
import { ChunkType, ComponentStructure } from '@teleporthq/teleport-types'
import { elementNode } from '@teleporthq/teleport-uidl-builders'
import generateJSXSyntax from '../../teleport-plugin-common/src/node-handlers/node-to-jsx'
import {
  JSXGenerationOptions,
  JSXGenerationParams,
} from '../../teleport-plugin-common/src/node-handlers/node-to-jsx/types'
import { createNextGlobalStateComponentPlugin } from '../src/global-state/component-plugin'

// A rendering condition can read a global state on either side. Whichever side
// reads it, the component has to take that state out of `useGlobalState()`, or
// the condition names a variable the file never declares.

const SELECTED_ID = 'f3a1c2d4-selected'
const PROFILE_ID = 'b7e9d0a2-profile'

const globalStateDefinitions = {
  [SELECTED_ID]: { id: SELECTED_ID, name: 'selectedRow', type: 'string', defaultValue: '' },
  [PROFILE_ID]: { id: PROFILE_ID, name: 'profile', type: 'object', defaultValue: {} },
} as unknown as JSXGenerationParams['globalStateDefinitions']

const globalState = (id: string, refPath?: string[]) => ({
  type: 'dynamic',
  content: { referenceType: 'globalState', id, ...(refPath ? { refPath } : {}) },
})

const options: JSXGenerationOptions = {
  dynamicReferencePrefixMap: { prop: 'props', state: '', local: '' },
  dependencyHandling: 'import',
  stateHandling: 'hooks',
  slotHandling: 'props',
  localIdentifier: 'row',
}

const generateComponent = async (renderingConditions: unknown): Promise<string> => {
  const conditionalChild = elementNode('container', {}, [])
  conditionalChild.content.renderingConditions = renderingConditions as never

  const params: JSXGenerationParams = {
    propDefinitions: {},
    stateDefinitions: {},
    globalStateDefinitions,
    nodesLookup: {},
    dependencies: {},
    windowImports: {},
    localeReferences: [],
    localeAttributeReferences: [],
    globalReferences: [],
    globalStateReferences: [],
    hoistedConstants: [],
  }
  const jsx = generateJSXSyntax(elementNode('container', {}, [conditionalChild]), params, options)

  const component = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('Rows'),
      types.arrowFunctionExpression(
        [types.identifier('props')],
        types.blockStatement([types.returnStatement(jsx)])
      )
    ),
  ])
  const structure = {
    uidl: { name: 'Rows', node: { type: 'element', content: {} } },
    options: {},
    dependencies: {},
    chunks: [
      {
        name: 'jsx-component',
        type: ChunkType.AST,
        fileType: 'js',
        content: component,
        linkAfter: [],
        meta: { globalStateReferences: params.globalStateReferences },
      },
    ],
  } as unknown as ComponentStructure

  const result = await createNextGlobalStateComponentPlugin()(structure)
  return generate(result.chunks[0].content as types.Node).code
}

const listItemField = { type: 'dynamic', content: { referenceType: 'local', refPath: ['id'] } }

describe('a rendering condition that reads a global state on its right side', () => {
  it('takes the state out of useGlobalState() and compares against it by name', async () => {
    const code = await generateComponent({
      reference: listItemField,
      condition: { conditions: [{ operation: '===', operand: globalState(SELECTED_ID) }] },
    })

    expect(code).toContain('selectedRow,')
    expect(code).toContain('} = useGlobalState();')
    expect(code).toContain('row.id === selectedRow &&')
    expect(code).not.toContain(SELECTED_ID)
  })

  it('takes an object state read through a field path', async () => {
    const code = await generateComponent({
      reference: listItemField,
      condition: {
        conditions: [{ operation: '===', operand: globalState(PROFILE_ID, ['team', 'id']) }],
      },
    })

    expect(code).toMatch(/\{\s*profile,\s*setProfile\s*\} = useGlobalState\(\);/)
    expect(code).toContain('row.id === profile?.team?.id &&')
    expect(code).not.toContain(PROFILE_ID)
  })

  it('takes both states of a global state compared against a global state', async () => {
    const code = await generateComponent({
      reference: globalState(SELECTED_ID),
      condition: { conditions: [{ operation: '===', operand: globalState(PROFILE_ID, ['id']) }] },
    })

    expect(code).toMatch(
      /\{\s*selectedRow,\s*setSelectedRow,\s*profile,\s*setProfile\s*\} = useGlobalState\(\);/
    )
    expect(code).toContain('selectedRow === profile?.id &&')
  })
})
