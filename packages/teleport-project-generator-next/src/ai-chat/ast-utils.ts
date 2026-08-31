import * as types from '@babel/types'
import { ComponentStructure } from '@teleporthq/teleport-types'

/**
 * Shared AST lookups for the plugins that edit the generated AI chat
 * component. Both of them splice statements around its state hooks, and both
 * must agree on exactly which declaration is which — a second, subtly
 * different matcher is how one plugin ends up silently doing nothing.
 */

/** State key holding the chat transcript (`AI_CHAT_MESSAGES_STATE_KEY`). */
export const CHAT_MESSAGES_STATE_KEY = 'chatMessages'

/** State key holding the id of the conversation being appended to. */
export const CHAT_CONVERSATION_ID_STATE_KEY = 'chatConversationId'

export const isChatComponent = (componentName: string): boolean => {
  return componentName.toLowerCase().replace(/[^a-z]/g, '') === 'aiassistantchat'
}

/** The `jsx-component` chunk, when it is the declaration these plugins expect. */
export const findJsxComponentChunk = (
  chunks: ComponentStructure['chunks']
): types.VariableDeclaration | null => {
  const chunk = chunks.find(
    (entry) =>
      entry.name === 'jsx-component' &&
      typeof entry.content === 'object' &&
      entry.content !== null &&
      'type' in entry.content &&
      (entry.content as types.Node).type === 'VariableDeclaration'
  )
  return chunk ? (chunk.content as types.VariableDeclaration) : null
}

export const findComponentBody = (
  chunkContent: types.VariableDeclaration
): types.BlockStatement | null => {
  const declarator = chunkContent.declarations[0] as types.VariableDeclarator | undefined
  const init = declarator?.init
  if (!init || init.type !== 'ArrowFunctionExpression' || init.body.type !== 'BlockStatement') {
    return null
  }
  return init.body
}

export interface StateHookMatch {
  /** Position of the declaration in the component body. */
  index: number
  declarator: types.VariableDeclarator
  setterName: string
}

/**
 * `const [<stateKey>, set<StateKey>] = useState(<init>)` — the declaration
 * `createStateHookAST` emits, with exactly one argument.
 *
 * The single-argument requirement is deliberate: it is what makes wrapping the
 * initializer safe, and what makes a second plugin's wrap visible to the first
 * (a wrapped call still has exactly one argument).
 */
export const findStateHook = (
  body: types.BlockStatement,
  stateKey: string
): StateHookMatch | null => {
  for (let index = 0; index < body.body.length; index++) {
    const statement = body.body[index]
    if (statement.type !== 'VariableDeclaration') {
      continue
    }
    for (const declarator of statement.declarations) {
      if (declarator.id.type !== 'ArrayPattern' || declarator.id.elements.length < 2) {
        continue
      }
      const [stateId, setterId] = declarator.id.elements
      if (
        !stateId ||
        stateId.type !== 'Identifier' ||
        stateId.name !== stateKey ||
        !setterId ||
        setterId.type !== 'Identifier'
      ) {
        continue
      }
      if (
        !declarator.init ||
        declarator.init.type !== 'CallExpression' ||
        declarator.init.callee.type !== 'Identifier' ||
        declarator.init.callee.name !== 'useState' ||
        declarator.init.arguments.length !== 1
      ) {
        continue
      }
      return { index, declarator, setterName: setterId.name }
    }
  }
  return null
}

/**
 * The `const x = identifier(...)` declarator anywhere inside `body`, so a later
 * plugin can wrap that call in place.
 *
 * Used to hand the session-restore call to the localization plugin, which runs
 * after the persistence plugin and has to wrap whatever produces a
 * `chatMessages` value — the `useState` initializer AND the restored transcript.
 */
export const findCallInitDeclarator = (
  body: types.BlockStatement,
  identifier: string
): types.VariableDeclarator | null => {
  let match: types.VariableDeclarator | null = null
  const visit = (node: unknown): void => {
    if (match || !node || typeof node !== 'object') {
      return
    }
    const candidate = node as types.Node
    if (
      candidate.type === 'VariableDeclarator' &&
      candidate.init?.type === 'CallExpression' &&
      candidate.init.callee.type === 'Identifier' &&
      candidate.init.callee.name === identifier
    ) {
      match = candidate
      return
    }
    for (const key of Object.keys(node)) {
      const value = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        value.forEach(visit)
      } else if (value && typeof value === 'object' && 'type' in (value as object)) {
        visit(value)
      }
    }
  }
  visit(body)
  return match
}

/** Whether the component body already calls `identifier(...)` anywhere. */
export const bodyCallsFunction = (body: types.BlockStatement, identifier: string): boolean => {
  let found = false
  const visit = (node: unknown): void => {
    if (found || !node || typeof node !== 'object') {
      return
    }
    const candidate = node as types.Node
    if (
      candidate.type === 'CallExpression' &&
      candidate.callee.type === 'Identifier' &&
      candidate.callee.name === identifier
    ) {
      found = true
      return
    }
    for (const key of Object.keys(node)) {
      const value = (node as unknown as Record<string, unknown>)[key]
      if (Array.isArray(value)) {
        value.forEach(visit)
      } else if (value && typeof value === 'object' && 'type' in (value as object)) {
        visit(value)
      }
    }
  }
  visit(body)
  return found
}
