import { ComponentPlugin, ComponentPluginFactory } from '@teleporthq/teleport-types'
import { GenericUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'
import { AI_CHAT_LOCALIZED_MESSAGES_PATH } from './localized-messages'
import { AI_CHAT_SESSION_STORE_FILE } from './session-store'
import {
  CHAT_CONVERSATION_ID_STATE_KEY,
  CHAT_MESSAGES_STATE_KEY,
  bodyCallsFunction,
  findComponentBody,
  findJsxComponentChunk,
  findStateHook,
  isChatComponent,
} from './ast-utils'

interface AIChatSessionPersistencePluginConfig {
  /** Output path of the generator using this plugin: `['components']` / `['pages']`. */
  basePath: string[]
}

const RESTORE_MESSAGES_IDENTIFIER = 'restoreAIChatMessages'
const RESTORE_CONVERSATION_IDENTIFIER = 'restoreAIChatConversationId'
const PERSIST_IDENTIFIER = 'persistAIChatSession'

/**
 * Locals introduced inside the restore effect. The localization plugin finds
 * the restore call by its CALLEE (`restoreAIChatMessages`), never by these
 * names, so they stay private.
 */
const RESTORED_MESSAGES_LOCAL = 'restoredChatMessages'
const RESTORED_CONVERSATION_LOCAL = 'restoredChatConversationId'
const RESTORED_REF_IDENTIFIER = '__aiChatSessionRestored'

/**
 * Keeps the visitor's conversation alive across client-side navigation.
 *
 * The chat is a component instance placed on each page, so following a link
 * unmounts it and React discards the transcript — the visitor loses their
 * conversation for clicking through to a product. This mirrors the two states
 * that make up a conversation into a module-level store that outlives the
 * unmount (see `session-store.ts` for why it is a `globalThis` bag and not
 * storage).
 *
 * Emitted shape:
 *
 *   const [chatMessages, setChatMessages] = useState([...])
 *   const [chatConversationId, setChatConversationId] = useState('')
 *   const __aiChatSessionRestored = useRef(false)
 *   useEffect(() => {
 *     const restoredChatMessages = restoreAIChatMessages(null)
 *     if (restoredChatMessages) { setChatMessages(restoredChatMessages) }
 *     const restoredChatConversationId = restoreAIChatConversationId(null)
 *     if (restoredChatConversationId) {
 *       setChatConversationId(restoredChatConversationId)
 *     }
 *   }, [])
 *   useEffect(() => {
 *     if (!__aiChatSessionRestored.current) {
 *       __aiChatSessionRestored.current = true
 *       return
 *     }
 *     persistAIChatSession(chatMessages, chatConversationId)
 *   }, [chatMessages, chatConversationId])
 *
 * ## ⛔ The restore MUST happen in an effect, never in the `useState` initializer
 *
 * The initializer runs DURING RENDER, on the server as well as the client. The
 * server has no session, so it renders the welcome bubble alone; the client
 * reads `sessionStorage` and renders the whole transcript. React compares the
 * two and throws "Hydration failed because the initial UI does not match what
 * was rendered on the server" — on every page load carrying a conversation,
 * which is exactly what following a product link out of the chat does.
 *
 * This shipped as an initializer while the store was a `globalThis` bag, where
 * a document load genuinely did start empty. Adding `sessionStorage` made the
 * store survive document loads and silently invalidated that reasoning. The
 * rule that survives both designs: an effect runs after the first paint, so the
 * first client render is the literal the server also rendered, and the restored
 * transcript arrives in a second render React performs itself.
 *
 * ⛔ The persist effect SKIPS its first run. It fires on mount before the
 * restore's `setState` has committed, so it would see the empty initial state
 * and `persistAIChatSession` would clear the very session being restored.
 *
 * ⛔ Runs BEFORE `createAIChatLocalizedWelcomePlugin`, so that plugin can wrap
 * BOTH values it owns — the `useState` initializer and the restored transcript
 * (`localizeAIChatMessages(restoreAIChatMessages(null), __aiChatLocale)`, which
 * is null-safe) — so a transcript restored on a page in another language still
 * gets its welcome bubble re-localized.
 *
 * The mirror effect covers workflow-driven updates too — `state-update-local-
 * state` calls the component's real setter, so clearing the conversation from
 * the chat header re-renders and empties the store through the same path.
 */
export const createAIChatSessionPersistencePlugin: ComponentPluginFactory<
  AIChatSessionPersistencePluginConfig
> = (config) => {
  const { basePath = ['components'] } = config || {}

  const plugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure

    // Applies to every chat, localized or not — unlike the welcome-message
    // plugin, this has nothing to do with languages.
    if (!options?.aiAssistantChat?.enabled) {
      return structure
    }

    if (!isChatComponent(uidl.name || '')) {
      return structure
    }

    if (!uidl.stateDefinitions?.[CHAT_MESSAGES_STATE_KEY]) {
      return structure
    }

    const jsxComponent = findJsxComponentChunk(chunks)
    if (!jsxComponent) {
      return structure
    }

    const componentBody = findComponentBody(jsxComponent)
    if (!componentBody) {
      return structure
    }

    // Idempotence: a second pass would nest restore() inside restore().
    if (bodyCallsFunction(componentBody, RESTORE_MESSAGES_IDENTIFIER)) {
      return structure
    }

    const messagesHook = findStateHook(componentBody, CHAT_MESSAGES_STATE_KEY)
    if (!messagesHook) {
      return structure
    }

    // The conversation id is optional only in the sense that a chat built by an
    // older editor may not declare it; when it is there the two must be
    // restored and mirrored together, or the visitor sees a transcript the
    // server will not append to.
    const conversationHook = findStateHook(componentBody, CHAT_CONVERSATION_ID_STATE_KEY)
    const hasConversationId = !!conversationHook

    const conversationArgument = (): types.Expression =>
      hasConversationId ? types.identifier(CHAT_CONVERSATION_ID_STATE_KEY) : types.stringLiteral('')

    /**
     * `const <local> = <restore>(null)` followed by
     * `if (<local>) { <setter>(<local>) }`.
     *
     * `null` rather than the state's own initial value: it is the signal that
     * there was nothing stored, and it keeps the effect from re-setting state
     * to a value equal to the one already rendered.
     */
    const restoreStatements = (
      localName: string,
      restoreIdentifier: string,
      setterName: string
    ): types.Statement[] => [
      types.variableDeclaration('const', [
        types.variableDeclarator(
          types.identifier(localName),
          types.callExpression(types.identifier(restoreIdentifier), [types.nullLiteral()])
        ),
      ]),
      types.ifStatement(
        types.identifier(localName),
        types.blockStatement([
          types.expressionStatement(
            types.callExpression(types.identifier(setterName), [types.identifier(localName)])
          ),
        ])
      ),
    ]

    const restoreEffect = types.expressionStatement(
      types.callExpression(types.identifier('useEffect'), [
        types.arrowFunctionExpression(
          [],
          types.blockStatement([
            ...restoreStatements(
              RESTORED_MESSAGES_LOCAL,
              RESTORE_MESSAGES_IDENTIFIER,
              messagesHook.setterName
            ),
            ...(conversationHook
              ? restoreStatements(
                  RESTORED_CONVERSATION_LOCAL,
                  RESTORE_CONVERSATION_IDENTIFIER,
                  conversationHook.setterName
                )
              : []),
          ])
        ),
        // Mount only: a conversation is handed over once per document load.
        types.arrayExpression([]),
      ])
    )

    const restoredFlag = types.memberExpression(
      types.identifier(RESTORED_REF_IDENTIFIER),
      types.identifier('current')
    )
    const restoredRefDeclaration = types.variableDeclaration('const', [
      types.variableDeclarator(
        types.identifier(RESTORED_REF_IDENTIFIER),
        types.callExpression(types.identifier('useRef'), [types.booleanLiteral(false)])
      ),
    ])

    const persistEffect = types.expressionStatement(
      types.callExpression(types.identifier('useEffect'), [
        types.arrowFunctionExpression(
          [],
          types.blockStatement([
            // ⛔ Skips the mount run. It fires before the restore's setState has
            // committed, so persisting here would write the empty initial state
            // over the session the effect above just read.
            types.ifStatement(
              types.unaryExpression('!', restoredFlag),
              types.blockStatement([
                types.expressionStatement(
                  types.assignmentExpression('=', restoredFlag, types.booleanLiteral(true))
                ),
                types.returnStatement(),
              ])
            ),
            types.expressionStatement(
              types.callExpression(types.identifier(PERSIST_IDENTIFIER), [
                types.identifier(CHAT_MESSAGES_STATE_KEY),
                conversationArgument(),
              ])
            ),
          ])
        ),
        // Fresh identifier nodes: sharing one across the tree lets any later
        // transform that mutates it in place edit every occurrence at once.
        types.arrayExpression(
          hasConversationId
            ? [types.identifier(CHAT_MESSAGES_STATE_KEY), conversationArgument()]
            : [types.identifier(CHAT_MESSAGES_STATE_KEY)]
        ),
      ])
    )

    // After BOTH hooks, so nothing here reads an identifier declared below it.
    const lastHookIndex = Math.max(
      messagesHook.index,
      hasConversationId ? conversationHook?.index ?? 0 : 0
    )
    componentBody.body.splice(
      lastHookIndex + 1,
      0,
      restoredRefDeclaration,
      restoreEffect,
      persistEffect
    )

    dependencies.useEffect = {
      type: 'library',
      path: 'react',
      version: '>=16.8.0',
      meta: { namedImport: true },
    }
    dependencies.useRef = {
      type: 'library',
      path: 'react',
      version: '>=16.8.0',
      meta: { namedImport: true },
    }

    const folderPath = uidl.outputOptions?.folderPath || []
    const relativePath = GenericUtils.generateLocalDependenciesPrefix(
      [...basePath, ...folderPath],
      AI_CHAT_LOCALIZED_MESSAGES_PATH
    )
    const storePath = `${relativePath}${AI_CHAT_SESSION_STORE_FILE}`
    dependencies[RESTORE_MESSAGES_IDENTIFIER] = {
      type: 'local',
      path: storePath,
      meta: { namedImport: true },
    }
    dependencies[PERSIST_IDENTIFIER] = {
      type: 'local',
      path: storePath,
      meta: { namedImport: true },
    }
    if (hasConversationId) {
      dependencies[RESTORE_CONVERSATION_IDENTIFIER] = {
        type: 'local',
        path: storePath,
        meta: { namedImport: true },
      }
    }

    return structure
  }

  return plugin
}
