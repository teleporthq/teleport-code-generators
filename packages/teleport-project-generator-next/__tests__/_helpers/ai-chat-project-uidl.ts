import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../../examples/test-samples/project-sample.json'

/**
 * A project UIDL with the AI assistant chat switched on, for tests that need to
 * run the REAL Next generator over it.
 *
 * `aiAssistantChat` is validated deeply by the chat plugins — a missing
 * `ragConfig.embeddingModel` fails the whole generation — so the shape lives
 * here once instead of being re-derived (and re-broken) per test file.
 */

export const EN_WELCOME = 'Hello! How can I help you today?'
export const ES_WELCOME = '¡Hola! ¿En qué puedo ayudarte?'
export const EN_UNKNOWN = 'I do not know.'
export const ES_UNKNOWN = 'No lo sé.'

const CHAT_COMPONENT = {
  name: 'ai-assistant-chat',
  stateDefinitions: {
    chatMessages: {
      type: 'array',
      defaultValue: [{ id: 'welcome_msg', sender: 'ai', message: EN_WELCOME, status: 'sent' }],
    },
    chatConversationId: { type: 'string', defaultValue: '' },
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

/** `localized` adds a second language, which turns the welcome-message plugin on. */
export const buildAIChatProjectUidl = (localized: boolean): ProjectUIDL => {
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

/** Walks `path` into the generated tree and returns the file, if it is there. */
export const findGeneratedFile = (
  folder: GeneratedFolder,
  path: string[],
  fileName: string
): GeneratedFolder['files'][number] | undefined => {
  let current: GeneratedFolder | undefined = folder
  for (const segment of path) {
    current = current?.subFolders.find((sub) => sub.name === segment)
  }
  return current?.files.find((file) => file.name === fileName)
}
