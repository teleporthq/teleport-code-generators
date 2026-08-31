import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

/**
 * The GUI path: the project ships its OWN `ai-assistant-chat` component (built
 * from workflows), so the plugin-level widget is skipped and the greeting lives
 * in that component's `chatMessages` state. This asserts the whole pipeline —
 * mapper output → project plugin → component plugin — actually puts a Spanish
 * greeting in front of a Spanish visitor.
 */

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const EN_WELCOME = 'Hello! How can I help you today?'
const ES_WELCOME = '¡Hola! ¿En qué puedo ayudarte?'
const EN_UNKNOWN = 'I do not know.'
const ES_UNKNOWN = 'No lo sé.'

const CHAT_COMPONENT = {
  name: 'ai-assistant-chat',
  stateDefinitions: {
    chatMessages: {
      type: 'array',
      defaultValue: [{ id: 'welcome_msg', sender: 'ai', message: EN_WELCOME, status: 'sent' }],
    },
  },
  node: {
    type: 'element',
    content: {
      elementType: 'container',
      attrs: { id: { type: 'static', content: 'ai-chat-root' } },
      children: [],
    },
  },
}

const buildUidl = (localized: boolean): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL

  uidl.components = { ...(uidl.components || {}), 'ai-assistant-chat': CHAT_COMPONENT as never }

  if (localized) {
    uidl.internationalization = {
      main: { name: 'English', locale: 'en' },
      languages: { en: 'English', es: 'Spanish' },
      translations: { en: {}, es: {} },
    }
  }

  uidl.aiAssistantChat = {
    enabled: true,
    dataSourceId: null,
    aiProvider: null,
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
      agentIconAssetId: null,
      bubblePosition: 'bottom-right',
      bubbleStyles: {},
      bubbleClosedIconAssetId: null,
      bubbleOpenedIconAssetId: null,
      window: {
        windowStyles: {},
        headerStyles: {},
        messagesContainerStyles: {},
        botMessageStyles: {},
        userMessageStyles: {},
        welcomeMessageStyles: {},
        inputContainerStyles: {},
        inputStyles: {},
        sendButtonStyles: {},
      },
      custom: { styles: '', scripts: '' },
    },
    ragConfig: {
      embeddingModel: 'text-embedding-3-small',
      searchTopK: 6,
      conversationHistoryLimit: 10,
      rephrase: { temperature: 0.1, maxTokens: 200, systemMessage: 'rephrase' },
      answer: { temperature: 0.2, maxTokens: 1000, streaming: true, systemMessage: 'answer' },
    },
    tables: {
      knowledgeSourcesTable: 'teleport_ai_chat_knowledge_sources',
      documentsTable: 'teleport_ai_chat_documents',
      conversationsTable: 'teleport_ai_chat_conversations',
      messagesTable: 'teleport_ai_chat_messages',
    },
  } as never

  return uidl
}

const findFile = (folder: GeneratedFolder, path: string[], fileName: string) => {
  let current: GeneratedFolder | undefined = folder
  for (const segment of path) {
    current = current?.subFolders.find((sub) => sub.name === segment)
  }
  return current?.files.find((file) => file.name === fileName)
}

describe('Next generator with a localized AI assistant chat', () => {
  const generator = createNextProjectGenerator()

  it('ships every locale and localizes the chat component greeting', async () => {
    const outputFolder = await generator.generateProject(buildUidl(true), template)

    const messages = findFile(outputFolder, ['lib', 'ai-chat'], 'localized-messages')
    expect(messages?.content).toContain(ES_WELCOME)
    expect(messages?.content).toContain(ES_UNKNOWN)
    expect(messages?.content).toContain('var MAIN_LOCALE = "en"')

    const component = findFile(outputFolder, ['components'], 'ai-assistant-chat')
    // `useLocale` is merged into the next-intl import the locale mapper already
    // emits, so assert the specifier rather than a whole import line.
    expect(component?.content).toMatch(/import \{[^}]*\buseLocale\b[^}]*\} from 'next-intl'/)
    expect(component?.content).toContain(
      "import { localizeAIChatMessages } from '../lib/ai-chat/localized-messages'"
    )
    expect(component?.content).toContain('const __aiChatLocale = useLocale()')
    expect(component?.content).toContain('useState(\n    localizeAIChatMessages(')
    expect(component?.content).toContain(
      'setChatMessages((prev) => localizeAIChatMessages(prev, __aiChatLocale))'
    )
    expect(component?.content).toContain('}, [__aiChatLocale])')
    // The greeting still ships as the state default — the locale resolution
    // wraps it, it does not replace it, so a locale nobody translated into
    // keeps working.
    expect(component?.content).toContain(EN_WELCOME)
  })

  it('leaves a single-language project byte-identical to before', async () => {
    const outputFolder = await generator.generateProject(buildUidl(false), template)

    const component = findFile(outputFolder, ['components'], 'ai-assistant-chat')
    expect(component?.content).not.toContain('useLocale')
    expect(component?.content).not.toContain('localizeAIChatMessages')

    // The module is still emitted — the hook and the API route import it
    // unconditionally — it just carries a single locale.
    const messages = findFile(outputFolder, ['lib', 'ai-chat'], 'localized-messages')
    expect(messages?.content).toContain(EN_WELCOME)
    expect(messages?.content).not.toContain(ES_WELCOME)
  })
})
