import { ComponentPlugin, ComponentPluginFactory } from '@teleporthq/teleport-types'
import { GenericUtils } from '@teleporthq/teleport-shared'
import * as types from '@babel/types'
import { isChatLocalized, AI_CHAT_LOCALIZED_MESSAGES_PATH } from './localized-messages'
import { USE_TRANSLATIONS_HOOK } from '../internationalization/locale-mapper-component'

interface AIChatLocalizedWelcomePluginConfig {
  /** Output path of the generator using this plugin: `['components']` / `['pages']`. */
  basePath: string[]
}

/**
 * State key holding the chat transcript. Set by the editor when it builds the
 * `ai-assistant-chat` component (`AI_CHAT_MESSAGES_STATE_KEY`); its first entry
 * is the welcome bubble.
 */
const CHAT_MESSAGES_STATE_KEY = 'chatMessages'

/** Local identifiers this plugin introduces, prefixed so they cannot collide. */
const LOCALE_IDENTIFIER = '__aiChatLocale'
const LOCALIZE_IDENTIFIER = 'localizeAIChatMessages'

const isChatComponent = (componentName: string): boolean => {
  return componentName.toLowerCase().replace(/[^a-z]/g, '') === 'aiassistantchat'
}

const findComponentBody = (
  chunkContent: types.VariableDeclaration
): types.BlockStatement | null => {
  const declarator = chunkContent.declarations[0] as types.VariableDeclarator | undefined
  const init = declarator?.init
  if (!init || init.type !== 'ArrowFunctionExpression' || init.body.type !== 'BlockStatement') {
    return null
  }
  return init.body
}

/** Idempotence guard: this plugin has already run over this component body. */
const declaresLocale = (body: types.BlockStatement): boolean =>
  body.body.some(
    (statement) =>
      statement.type === 'VariableDeclaration' &&
      statement.declarations.some(
        (declaration) =>
          declaration.id.type === 'Identifier' && declaration.id.name === LOCALE_IDENTIFIER
      )
  )

/**
 * `const [chatMessages, setChatMessages] = useState(<init>)` — the declaration
 * `createStateHookAST` emits for the transcript state.
 */
const findMessagesStateHook = (
  body: types.BlockStatement
): { index: number; declarator: types.VariableDeclarator; setterName: string } | null => {
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
        stateId.name !== CHAT_MESSAGES_STATE_KEY ||
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
 * Makes the AI chat component's welcome bubble follow the visitor's locale.
 *
 * ⛔ Why this is not the ordinary i18n path. Every other translated string in a
 * generated page is a text NODE, so the locale mapper rewrites it into
 * `translate.raw('key')` and next-intl resolves it per request. The welcome
 * message is not a node — it is the first entry of the `chatMessages` STATE,
 * whose initial value is a literal baked into `useState`. Nothing in the
 * existing pipeline can reach inside that literal, so the component gets an
 * explicit `useLocale()` and resolves the greeting through the generated
 * `lib/ai-chat/localized-messages` module instead.
 *
 * Emitted shape:
 *
 *   const __aiChatLocale = useLocale()
 *   const [chatMessages, setChatMessages] = useState(
 *     localizeAIChatMessages([...], __aiChatLocale)
 *   )
 *   useEffect(() => {
 *     setChatMessages((prev) => localizeAIChatMessages(prev, __aiChatLocale))
 *   }, [__aiChatLocale])
 *
 * The declaration is spliced in immediately BEFORE the state hook rather than
 * unshifted: several plugins unshift their own hooks, and a `useLocale()` that
 * landed after the `useState` reading it would be a temporal-dead-zone crash on
 * the first render. Splicing keeps the pair adjacent whatever else is prepended
 * later.
 *
 * The effect exists because a Next.js locale switch is a client-side route
 * change that keeps the same component mounted, so `useState`'s initializer —
 * which only ever runs once — would leave the greeting in the previous
 * language. It is a no-op on mount and whenever the visitor has already sent a
 * message: `localizeAIChatMessages` only rewrites an untouched `welcome_msg`
 * entry and returns the SAME array reference otherwise, so the functional
 * update cannot loop.
 */
export const createAIChatLocalizedWelcomePlugin: ComponentPluginFactory<
  AIChatLocalizedWelcomePluginConfig
> = (config) => {
  const { basePath = ['components'] } = config || {}

  const plugin: ComponentPlugin = async (structure) => {
    const { uidl, chunks, dependencies, options } = structure

    const chat = options?.aiAssistantChat
    if (!chat?.enabled || !isChatLocalized(chat)) {
      return structure
    }

    if (!isChatComponent(uidl.name || '')) {
      return structure
    }

    if (!uidl.stateDefinitions?.[CHAT_MESSAGES_STATE_KEY]) {
      return structure
    }

    const jsxComponent = chunks.find(
      (chunk) =>
        chunk.name === 'jsx-component' &&
        typeof chunk.content === 'object' &&
        chunk.content !== null &&
        'type' in chunk.content &&
        (chunk.content as types.Node).type === 'VariableDeclaration'
    )
    if (!jsxComponent) {
      return structure
    }

    const componentBody = findComponentBody(jsxComponent.content as types.VariableDeclaration)
    if (!componentBody) {
      return structure
    }

    if (declaresLocale(componentBody)) {
      return structure
    }

    const stateHook = findMessagesStateHook(componentBody)
    if (!stateHook) {
      return structure
    }

    const { index, declarator, setterName } = stateHook
    const initialValue = (declarator.init as types.CallExpression).arguments[0]
    if (!types.isExpression(initialValue)) {
      return structure
    }

    // A fresh identifier node per occurrence: sharing one across the tree makes
    // any later AST transform that mutates it in place edit all four at once.
    const locale = () => types.identifier(LOCALE_IDENTIFIER)

    // useState(localizeAIChatMessages(<init>, __aiChatLocale))
    ;(declarator.init as types.CallExpression).arguments = [
      types.callExpression(types.identifier(LOCALIZE_IDENTIFIER), [initialValue, locale()]),
    ]

    const localeDeclaration = types.variableDeclaration('const', [
      types.variableDeclarator(locale(), types.callExpression(types.identifier('useLocale'), [])),
    ])

    const relocalizeEffect = types.expressionStatement(
      types.callExpression(types.identifier('useEffect'), [
        types.arrowFunctionExpression(
          [],
          types.blockStatement([
            types.expressionStatement(
              types.callExpression(types.identifier(setterName), [
                types.arrowFunctionExpression(
                  [types.identifier('prev')],
                  types.callExpression(types.identifier(LOCALIZE_IDENTIFIER), [
                    types.identifier('prev'),
                    locale(),
                  ])
                ),
              ])
            ),
          ])
        ),
        types.arrayExpression([locale()]),
      ])
    )

    componentBody.body.splice(index, 0, localeDeclaration)
    componentBody.body.splice(index + 2, 0, relocalizeEffect)

    dependencies.useLocale = { ...USE_TRANSLATIONS_HOOK }
    dependencies.useEffect = {
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
    dependencies[LOCALIZE_IDENTIFIER] = {
      type: 'local',
      path: `${relativePath}localized-messages`,
      meta: { namedImport: true },
    }

    return structure
  }

  return plugin
}
