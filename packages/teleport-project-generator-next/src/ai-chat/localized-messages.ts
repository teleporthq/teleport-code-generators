import { UIDLAIAssistantChat, UIDLAIAssistantChatMessages } from '@teleporthq/teleport-types'

/** Where the generated per-locale chat copy module is written. */
export const AI_CHAT_LOCALIZED_MESSAGES_PATH = ['lib', 'ai-chat']
export const AI_CHAT_LOCALIZED_MESSAGES_FILE = 'localized-messages'

/** Fallback used when the settings carry no welcome text at all. */
const DEFAULT_WELCOME_MESSAGE = 'Hello! How can I help you?'

/**
 * True when the project actually serves more than one language. Every
 * locale-resolution branch in the generated code is gated on this, so a
 * single-language project emits exactly what it emitted before localized chat
 * copy existed.
 */
export function isChatLocalized(chat: UIDLAIAssistantChat): boolean {
  const locales = chat.localization?.locales || []
  return locales.length > 1 && !!chat.chatSettings.translations
}

/**
 * The copy of every locale, main locale included and always complete.
 *
 * A single-language project still gets a one-entry map: the generated module is
 * emitted unconditionally so the API route and the hook can import it without
 * branching on whether the project has languages.
 */
export function buildChatMessagesByLocale(
  chat: UIDLAIAssistantChat
): Record<string, UIDLAIAssistantChatMessages> {
  const mainLocale = resolveMainLocale(chat)
  const fallback: UIDLAIAssistantChatMessages = {
    welcomeMessage: chat.chatSettings.welcomeMessage || DEFAULT_WELCOME_MESSAGE,
    unknownInformationMessage: chat.chatSettings.unknownInformationMessage || '',
  }

  const byLocale: Record<string, UIDLAIAssistantChatMessages> = { [mainLocale]: fallback }
  for (const [locale, messages] of Object.entries(chat.chatSettings.translations || {})) {
    byLocale[locale] = {
      welcomeMessage: messages?.welcomeMessage || fallback.welcomeMessage,
      unknownInformationMessage:
        messages?.unknownInformationMessage || fallback.unknownInformationMessage,
    }
  }

  return byLocale
}

/** The locale whose copy lives in the flat `chatSettings` fields. */
export function resolveMainLocale(chat: UIDLAIAssistantChat): string {
  return chat.localization?.mainLocale || 'en'
}

/**
 * Every distinct "I don't know" sentence the assistant may produce.
 *
 * The answer prompt lists one per language and lets the model pick by the
 * language the visitor wrote in, so the `covered_by_knowledge` check has to
 * recognise all of them — matching only the main-locale sentence would record a
 * translated refusal as a covered answer.
 */
export function collectUnknownInformationMessages(chat: UIDLAIAssistantChat): string[] {
  const messages = Object.values(buildChatMessagesByLocale(chat)).map(
    (entry) => entry.unknownInformationMessage
  )
  const unique: string[] = []
  for (const message of messages) {
    if (message && unique.indexOf(message) === -1) {
      unique.push(message)
    }
  }
  return unique
}

/**
 * The runtime module every other generated file resolves chat copy through.
 *
 * `resolveAIChatLocale` is deliberately forgiving: Next.js hands out whatever
 * locale the route carries (`es`, but also `es-MX` or `pt-BR` when the project
 * declares regional locales), and an `Accept-Language` header can be anything
 * at all. Anything it cannot place falls back to the main locale, which is the
 * same rule the editor applies to an untranslated field.
 */
export function generateLocalizedMessagesCode(chat: UIDLAIAssistantChat): string {
  const mainLocale = resolveMainLocale(chat)
  const messagesByLocale = buildChatMessagesByLocale(chat)
  const unknownInformationMessages = collectUnknownInformationMessages(chat)

  return `// AI assistant chat copy, one entry per locale. Generated — do not edit.
var MAIN_LOCALE = ${JSON.stringify(mainLocale)};
var MESSAGES_BY_LOCALE = ${JSON.stringify(messagesByLocale, null, 2)};
var UNKNOWN_INFORMATION_MESSAGES = ${JSON.stringify(unknownInformationMessages)};

export function resolveAIChatLocale(locale) {
  if (!locale || typeof locale !== 'string') {
    return MAIN_LOCALE;
  }
  if (MESSAGES_BY_LOCALE[locale]) {
    return locale;
  }
  var normalized = locale.toLowerCase().replace('_', '-');
  var keys = Object.keys(MESSAGES_BY_LOCALE);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === normalized) {
      return keys[i];
    }
  }
  // 'es-MX' -> 'es': a regional variant answers in its base language rather
  // than silently reverting to the main one.
  var base = normalized.split('-')[0];
  for (var j = 0; j < keys.length; j++) {
    if (keys[j].toLowerCase().split('-')[0] === base) {
      return keys[j];
    }
  }
  return MAIN_LOCALE;
}

export function getAIChatMessages(locale) {
  return MESSAGES_BY_LOCALE[resolveAIChatLocale(locale)] || MESSAGES_BY_LOCALE[MAIN_LOCALE];
}

export function getAIChatWelcomeMessage(locale) {
  return getAIChatMessages(locale).welcomeMessage;
}

export function getAIChatUnknownInformationMessage(locale) {
  return getAIChatMessages(locale).unknownInformationMessage;
}

export function getAIChatUnknownInformationMessages() {
  return UNKNOWN_INFORMATION_MESSAGES;
}

/**
 * Re-points a message list's welcome bubble at \`locale\`.
 *
 * Only the greeting is touched, and only when it is still the entry the chat
 * seeded (\`id === 'welcome_msg'\`, the id both the editor and the widget use).
 * Everything else is conversation the visitor and the assistant produced, and
 * rewriting any of it would silently edit their history.
 */
export function localizeAIChatMessages(messages, locale) {
  var list = messages;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (_e) {
      return messages;
    }
  }
  if (!Array.isArray(list) || list.length === 0) {
    return messages;
  }

  var welcomeMessage = getAIChatWelcomeMessage(locale);
  var first = list[0];
  if (!first || first.id !== 'welcome_msg' || first.message === welcomeMessage) {
    return messages;
  }

  var next = list.slice();
  next[0] = Object.assign({}, first, { message: welcomeMessage });
  return typeof messages === 'string' ? JSON.stringify(next) : next;
}
`
}
