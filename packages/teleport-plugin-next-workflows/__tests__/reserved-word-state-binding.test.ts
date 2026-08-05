/**
 * The page-level `__createWorkflowHandlers(stateSetters, stateTypes, stateValuesRef)`
 * maps are keyed BY THE UIDL STATE NAME — that is what the runtime looks up when
 * a node config says `{"property": "class"}` or a `state-batch-update` carries
 * `{"key": "class"}`. Both shapes appear verbatim in the run that broke.
 *
 * So the fix for the reserved-word crash has to be asymmetric:
 *   KEY   → the UIDL name, ALWAYS (renaming it silently breaks every workflow
 *           binding written against it — `__stateNameMap` has no camel→original
 *           entry, so the runtime would just warn "no setter for class" and skip)
 *   VALUE → the sanitised React binding, because `const [class, …]` is a
 *           SyntaxError and the whole project build dies on it.
 */

import generate from '@babel/generator'
import * as types from '@babel/types'
import { createNextWorkflowPlugin } from '../src/workflow-component-plugin'

/** `const Page = (props) => { return null }` — the shape the plugin injects into. */
const buildComponentChunkContent = (): types.VariableDeclaration =>
  types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier('AddCharacter'),
      types.arrowFunctionExpression(
        [types.identifier('props')],
        types.blockStatement([types.returnStatement(types.nullLiteral())])
      )
    ),
  ])

const buildStructure = (stateNames: string[]): any => {
  const triggerNodeId = 'trigger-1'
  const workflow = {
    id: 'wf-1',
    name: 'Batch update from the form',
    trigger: {
      type: 'event-page-loaded',
      nodeId: triggerNodeId,
      scope: 'page',
      config: { pageId: 'page-1' },
    },
    nodes: [
      {
        id: 'batch-1',
        type: 'state-batch-update',
        config: {
          scope: 'local',
          updates: stateNames.map((name) => ({ key: name, value: '' })),
        },
        stepNumber: 1,
        label: 'Batch State Update',
      },
    ],
    edges: [{ id: 'e', source: triggerNodeId, target: 'batch-1' }],
  }
  return {
    uidl: {
      name: 'AddCharacter',
      outputOptions: { pageId: 'page-1', fileName: 'add-character' },
      node: { type: 'element', content: { elementType: 'container', name: 'Container' } },
      stateDefinitions: Object.fromEntries(
        stateNames.map((name) => [name, { type: 'string', defaultValue: '' }])
      ),
    },
    chunks: [
      {
        type: 'chunk-type-ast',
        name: 'jsx-component',
        content: buildComponentChunkContent(),
      },
    ],
    options: { workflows: { workflows: { 'wf-1': workflow }, customNodes: {} } },
    dependencies: {},
  }
}

const generateComponentCode = async (stateNames: string[]): Promise<string> => {
  const plugin = createNextWorkflowPlugin({ isPage: true })
  const structure = buildStructure(stateNames)
  await plugin(structure as any)
  const componentChunk = (structure.chunks as any[]).find((c: any) => c.name === 'jsx-component')
  // The maps are injected into the component BODY, not the module chunk.
  return generate(componentChunk.content).code
}

describe('reserved-word state in the workflow runtime maps', () => {
  it('keys every map by the UIDL name so `config.property` still resolves', async () => {
    const code = await generateComponentCode(['class', 'characterName'])
    // `{ class: … }` is a legal object key even though `class` is reserved.
    expect(code).toMatch(/class:\s*setClass/)
    expect(code).toMatch(/class:\s*["']string["']/)
  })

  it('binds the VALUE to the sanitised identifier the state hook declared', async () => {
    const code = await generateComponentCode(['class', 'characterName'])
    // __wfStateRef.current = { class: class_ }  — never `class: class`.
    expect(code).toMatch(/class:\s*class_/)
    expect(code).not.toMatch(/class:\s*class\b(?!_)/)
  })

  it('leaves ordinary state names byte-identical', async () => {
    const code = await generateComponentCode(['class', 'characterName'])
    expect(code).toMatch(/characterName:\s*characterName/)
    expect(code).toMatch(/characterName:\s*setCharacterName/)
  })

  it('quotes a key that is not identifier syntax instead of emitting it bare', async () => {
    const code = await generateComponentCode(['my key'])
    expect(code).toContain('"my key"')
    expect(code).not.toMatch(/[^"']my key:/)
  })
})
