import {
  ChunkType,
  ComponentStructure,
  FileType,
  GeneratorOptions,
  UIDLAIAssistantChat,
} from '@teleporthq/teleport-types'
import * as types from '@babel/types'
import { CodeGenerator } from '@babel/generator'
import { parse } from '@babel/parser'
import { generateHookCode } from '../src/ai-chat/hook-generator'
import {
  buildChatMessagesByLocale,
  collectUnknownInformationMessages,
  generateLocalizedMessagesCode,
  isChatLocalized,
} from '../src/ai-chat/localized-messages'
import { createAIChatLocalizedWelcomePlugin } from '../src/ai-chat/component-plugin'

const EN_WELCOME = 'Hello! How can I help you today?'
const ES_WELCOME = '¡Hola! ¿En qué puedo ayudarte?'
const EN_UNKNOWN = 'I do not know.'
const ES_UNKNOWN = 'No lo sé.'

const buildChat = (localized: boolean): UIDLAIAssistantChat =>
  ({
    enabled: true,
    ...(localized && { localization: { mainLocale: 'en', locales: ['en', 'es'] } }),
    chatSettings: {
      chatName: 'Assistant',
      welcomeMessage: EN_WELCOME,
      unknownInformationMessage: EN_UNKNOWN,
      ...(localized && {
        translations: {
          en: { welcomeMessage: EN_WELCOME, unknownInformationMessage: EN_UNKNOWN },
          es: { welcomeMessage: ES_WELCOME, unknownInformationMessage: ES_UNKNOWN },
        },
      }),
    },
  } as unknown as UIDLAIAssistantChat)

/** The generated module's exports, as callable in a test. */
interface GeneratedMessagesModule {
  resolveAIChatLocale: (locale: unknown) => string
  getAIChatWelcomeMessage: (locale: unknown) => string
  getAIChatUnknownInformationMessage: (locale: unknown) => string
  getAIChatUnknownInformationMessages: () => string[]
  localizeAIChatMessages: (messages: unknown, locale: unknown) => unknown
}

/** Evaluates the generated ES module by stripping its `export` keywords. */
function loadGeneratedModule(chat: UIDLAIAssistantChat): GeneratedMessagesModule {
  const source = generateLocalizedMessagesCode(chat).replace(/export function/g, 'function')
  // eslint-disable-next-line no-new-func
  return new Function(
    `${source}; return { resolveAIChatLocale, getAIChatWelcomeMessage, getAIChatUnknownInformationMessage, getAIChatUnknownInformationMessages, localizeAIChatMessages };`
  )()
}

describe('isChatLocalized', () => {
  it('is false without a localization block, so nothing downstream branches', () => {
    expect(isChatLocalized(buildChat(false))).toBe(false)
  })

  it('is true once the project carries more than one locale', () => {
    expect(isChatLocalized(buildChat(true))).toBe(true)
  })
})

describe('buildChatMessagesByLocale', () => {
  it('always has the main locale, single-language project included', () => {
    expect(buildChatMessagesByLocale(buildChat(false))).toEqual({
      en: { welcomeMessage: EN_WELCOME, unknownInformationMessage: EN_UNKNOWN },
    })
  })

  it('falls back to the main copy for a locale missing a field', () => {
    const chat = buildChat(true)
    chat.chatSettings.translations = { es: { welcomeMessage: ES_WELCOME } } as never
    expect(buildChatMessagesByLocale(chat).es).toEqual({
      welcomeMessage: ES_WELCOME,
      unknownInformationMessage: EN_UNKNOWN,
    })
  })
})

describe('collectUnknownInformationMessages', () => {
  it('deduplicates identical sentences across locales', () => {
    expect(collectUnknownInformationMessages(buildChat(true))).toEqual([EN_UNKNOWN, ES_UNKNOWN])
    expect(collectUnknownInformationMessages(buildChat(false))).toEqual([EN_UNKNOWN])
  })
})

describe('the generated localized-messages module', () => {
  const mod = loadGeneratedModule(buildChat(true))

  it('resolves an exact locale', () => {
    expect(mod.getAIChatWelcomeMessage('es')).toBe(ES_WELCOME)
    expect(mod.getAIChatUnknownInformationMessage('es')).toBe(ES_UNKNOWN)
  })

  it('resolves a regional variant to its base language', () => {
    expect(mod.getAIChatWelcomeMessage('es-MX')).toBe(ES_WELCOME)
    expect(mod.getAIChatWelcomeMessage('ES_mx')).toBe(ES_WELCOME)
  })

  it('falls back to the main locale for an unknown or absent locale', () => {
    expect(mod.getAIChatWelcomeMessage('de')).toBe(EN_WELCOME)
    expect(mod.getAIChatWelcomeMessage(undefined)).toBe(EN_WELCOME)
    expect(mod.getAIChatWelcomeMessage(null)).toBe(EN_WELCOME)
    expect(mod.resolveAIChatLocale(42)).toBe('en')
  })

  it('exposes every refusal sentence for the coverage check', () => {
    expect(mod.getAIChatUnknownInformationMessages()).toEqual([EN_UNKNOWN, ES_UNKNOWN])
  })

  describe('localizeAIChatMessages', () => {
    const welcome = (message: string) => ({
      id: 'welcome_msg',
      sender: 'ai',
      message,
      status: 'sent',
    })

    it('re-points the greeting at the requested locale', () => {
      expect(mod.localizeAIChatMessages([welcome(EN_WELCOME)], 'es')).toEqual([welcome(ES_WELCOME)])
    })

    it('returns the SAME reference when nothing changes, so an effect cannot loop', () => {
      const messages = [welcome(ES_WELCOME)]
      expect(mod.localizeAIChatMessages(messages, 'es')).toBe(messages)
    })

    it("never rewrites the visitor's conversation", () => {
      const conversation = [
        { id: 'm1', sender: 'user', message: 'Hi', status: 'sent' },
        { id: 'm2', sender: 'ai', message: 'Hello', status: 'sent' },
      ]
      expect(mod.localizeAIChatMessages(conversation, 'es')).toBe(conversation)
    })

    it('leaves later messages alone while swapping the greeting', () => {
      const result = mod.localizeAIChatMessages(
        [welcome(EN_WELCOME), { id: 'm1', sender: 'user', message: 'Hi', status: 'sent' }],
        'es'
      ) as Array<{ message: string }>
      expect(result[0].message).toBe(ES_WELCOME)
      expect(result[1].message).toBe('Hi')
    })

    it('round-trips a JSON-string list in the same shape it received', () => {
      const asString = JSON.stringify([welcome(EN_WELCOME)])
      const result = mod.localizeAIChatMessages(asString, 'es') as string
      expect(typeof result).toBe('string')
      expect(JSON.parse(result)[0].message).toBe(ES_WELCOME)
    })

    it('survives anything that is not a message list', () => {
      expect(mod.localizeAIChatMessages('not json', 'es')).toBe('not json')
      expect(mod.localizeAIChatMessages([], 'es')).toEqual([])
      expect(mod.localizeAIChatMessages(null, 'es')).toBe(null)
    })
  })
})

describe('the generated sources are valid ES modules', () => {
  // Both files are assembled from template literals, where an unbalanced brace
  // or a stray backtick produces a project that only fails at `next build`.
  const parses = (code: string) => () => parse(code, { sourceType: 'module', plugins: ['jsx'] })

  it('parses the localized-messages module', () => {
    expect(parses(generateLocalizedMessagesCode(buildChat(true)))).not.toThrow()
    expect(parses(generateLocalizedMessagesCode(buildChat(false)))).not.toThrow()
  })

  it('parses the chat hook in both response modes', () => {
    for (const streaming of [true, false]) {
      const chat = {
        ...buildChat(true),
        ragConfig: { answer: { streaming } },
      } as unknown as UIDLAIAssistantChat
      expect(parses(generateHookCode(chat))).not.toThrow()
    }
  })

  it('resolves the hook greeting through the locale module', () => {
    const code = generateHookCode({
      ...buildChat(true),
      ragConfig: { answer: { streaming: true } },
    } as unknown as UIDLAIAssistantChat)

    expect(code).toContain(
      "import { getAIChatWelcomeMessage, localizeAIChatMessages } from '../lib/ai-chat/localized-messages'"
    )
    expect(code).toContain('getAIChatWelcomeMessage(locale)')
    expect(code).toContain('localizeAIChatMessages(prev, locale)')
    // No baked greeting is left behind for the locale resolution to contradict.
    expect(code).not.toContain('var WELCOME_MSG =')
  })
})

// ─── Component plugin ────────────────────────────────────────────────────────

const CHAT_MESSAGES_DEFAULT = [
  { id: 'welcome_msg', sender: 'ai', message: EN_WELCOME, status: 'sent' },
]

/** A minimal `const AiAssistantChat = (props) => { const [chatMessages, …] … }`. */
function buildComponentStructure(componentName: string): ComponentStructure {
  const stateHook = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.arrayPattern([types.identifier('chatMessages'), types.identifier('setChatMessages')]),
      types.callExpression(types.identifier('useState'), [
        types.arrayExpression(
          CHAT_MESSAGES_DEFAULT.map((message) =>
            types.objectExpression(
              Object.entries(message).map(([key, value]) =>
                types.objectProperty(types.identifier(key), types.stringLiteral(String(value)))
              )
            )
          )
        ),
      ])
    ),
  ])

  const component = types.variableDeclaration('const', [
    types.variableDeclarator(
      types.identifier(componentName),
      types.arrowFunctionExpression(
        [types.identifier('props')],
        types.blockStatement([stateHook, types.returnStatement(types.nullLiteral())])
      )
    ),
  ])

  return {
    uidl: {
      name: componentName,
      node: { type: 'element', content: { elementType: 'container' } },
      stateDefinitions: {
        chatMessages: {
          type: 'array',
          defaultValue: CHAT_MESSAGES_DEFAULT,
        },
      },
    },
    chunks: [
      {
        type: ChunkType.AST,
        fileType: FileType.JS,
        name: 'jsx-component',
        content: component,
        linkAfter: [],
      },
    ],
    dependencies: {},
  } as unknown as ComponentStructure
}

const printComponent = (structure: ComponentStructure): string =>
  new CodeGenerator(structure.chunks[0].content as types.Node).generate().code

describe('createAIChatLocalizedWelcomePlugin', () => {
  const plugin = createAIChatLocalizedWelcomePlugin({ basePath: ['components'] })
  const options = (chat: UIDLAIAssistantChat) =>
    ({ aiAssistantChat: chat } as unknown as GeneratorOptions)

  it('localizes the chat component initial state and re-localizes on a locale change', async () => {
    const structure = buildComponentStructure('AiAssistantChat')
    structure.options = options(buildChat(true))

    const result = await plugin(structure)
    const code = printComponent(result)

    expect(code).toContain('const __aiChatLocale = useLocale()')
    expect(code).toContain('useState(localizeAIChatMessages([')
    expect(code).toContain('setChatMessages(prev => localizeAIChatMessages(prev, __aiChatLocale))')
    expect(code).toContain('}, [__aiChatLocale])')

    expect(result.dependencies.useLocale.path).toBe('next-intl')
    expect(result.dependencies.localizeAIChatMessages).toEqual({
      type: 'local',
      path: '../lib/ai-chat/localized-messages',
      meta: { namedImport: true },
    })
  })

  it('declares the locale BEFORE the state hook that reads it', () => {
    // A `useLocale()` landing after its `useState` would be a temporal dead
    // zone crash on the very first render of every page carrying the chat.
    const structure = buildComponentStructure('AiAssistantChat')
    structure.options = options(buildChat(true))

    return plugin(structure).then((result) => {
      const code = printComponent(result)
      expect(code.indexOf('__aiChatLocale = useLocale()')).toBeLessThan(
        code.indexOf('useState(localizeAIChatMessages')
      )
    })
  })

  it('leaves a single-language project completely untouched', async () => {
    const structure = buildComponentStructure('AiAssistantChat')
    structure.options = options(buildChat(false))
    const before = printComponent(structure)

    const result = await plugin(structure)

    expect(printComponent(result)).toBe(before)
    expect(result.dependencies.useLocale).toBeUndefined()
  })

  it('ignores every component that is not the chat', async () => {
    const structure = buildComponentStructure('ProductCard')
    structure.options = options(buildChat(true))
    const before = printComponent(structure)

    const result = await plugin(structure)

    expect(printComponent(result)).toBe(before)
  })
})
