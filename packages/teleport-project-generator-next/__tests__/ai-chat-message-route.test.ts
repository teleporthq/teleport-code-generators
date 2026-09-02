import { UIDLAIAssistantChat } from '@teleporthq/teleport-types'
import { generateMessageRouteCode } from '../src/ai-chat/api-route-generator'

/**
 * The plugin-level chat runtime (used when the project has no UIDL
 * ai-assistant-chat component). Same two defects as the workflow runtime:
 * `covered_by_knowledge` was a constant true, and the retrieved records were
 * flattened onto one line before the model saw them.
 */

const UNKNOWN = "I apologize, but I don't have enough information in my knowledge base."

const buildChat = (streaming: boolean): UIDLAIAssistantChat =>
  ({
    enabled: true,
    tables: {
      knowledgeSourcesTable: 'teleport_ai_chat_knowledge_sources',
      documentsTable: 'teleport_ai_chat_documents',
      conversationsTable: 'teleport_ai_chat_conversations',
      messagesTable: 'teleport_ai_chat_messages',
    },
    chatSettings: { unknownInformationMessage: UNKNOWN },
    ragConfig: {
      embeddingModel: 'text-embedding-3-small',
      searchTopK: 6,
      conversationHistoryLimit: 10,
      rephrase: { temperature: 0.1, maxTokens: 200, systemMessage: 'rephrase' },
      answer: { temperature: 0.2, maxTokens: 1000, streaming, systemMessage: 'answer' },
    },
  } as unknown as UIDLAIAssistantChat)

/** Runs the generated route's coverage helper in isolation. */
function coverageHelper(code: string): (answer: unknown) => boolean {
  const start = code.indexOf('var UNKNOWN_INFORMATION_MESSAGES =')
  if (start < 0) {
    throw new Error('the coverage helper is no longer where this test slices it from')
  }
  const end =
    code.indexOf('\n    }', code.indexOf('function answeredFromKnowledge')) + '\n    }'.length
  const snippet = code.slice(start, end)
  // eslint-disable-next-line no-new-func
  return new Function(`${snippet}; return answeredFromKnowledge;`)()
}

describe('ai-chat message route', () => {
  const streamingCode = generateMessageRouteCode(buildChat(true))
  const blockingCode = generateMessageRouteCode(buildChat(false))

  it('keeps the record structure of a retrieved chunk', () => {
    // The old route ran `.replace(/\n/g, ' ')` over every chunk, dissolving
    // "Product: … / Price: …" into one undifferentiated line.
    expect(streamingCode).not.toContain("(r.doc.content || '').replace(/\\n/g, ' ')")
    expect(streamingCode).toContain("String(r.doc.content || r.doc.search_content || '').trim()")
  })

  it('fences the retrieved documents apart', () => {
    expect(streamingCode).toContain("contextChunks.join('\\n\\n---\\n\\n')")
  })

  it('never marks a reply as covered when nothing was retrieved', () => {
    for (const code of [streamingCode, blockingCode]) {
      expect(code).toContain('var coveredByKnowledge = contextChunks.length > 0 &&')
    }
  })

  it('reads the answer that each response mode actually produced', () => {
    expect(streamingCode).toContain('answeredFromKnowledge(fullResponse)')
    expect(blockingCode).toContain('answeredFromKnowledge(aiResponse)')
  })

  it('no longer sets coverage from the mere presence of search results', () => {
    expect(streamingCode).not.toContain('coveredByKnowledge = true')
  })

  describe('the generated coverage helper', () => {
    const answered = coverageHelper(streamingCode)

    it('rejects the configured fallback sentence', () => {
      expect(answered(UNKNOWN)).toBe(false)
      expect(answered(`Sorry. ${UNKNOWN} Please email us.`)).toBe(false)
      expect(answered(`  ${UNKNOWN.toUpperCase()}  `)).toBe(false)
    })

    it('accepts a real answer', () => {
      expect(answered('We sell bridal gowns, veils and suit rentals.')).toBe(true)
    })

    it('rejects an empty or absent answer', () => {
      expect(answered('')).toBe(false)
      expect(answered(null)).toBe(false)
      expect(answered(undefined)).toBe(false)
    })

    it('treats every answer as covered when no fallback is configured', () => {
      const noFallback = generateMessageRouteCode({
        ...buildChat(true),
        chatSettings: {},
      } as unknown as UIDLAIAssistantChat)
      expect(coverageHelper(noFallback)('anything at all')).toBe(true)
    })

    it('rejects the fallback of ANY language on a multilingual project', () => {
      // The prompt hands the model one refusal sentence per language and lets
      // it answer in the visitor's own. Matching only the main-language one
      // would file a Spanish refusal as an answer the knowledge base covered.
      const multilingual = generateMessageRouteCode({
        ...buildChat(true),
        localization: { mainLocale: 'en', locales: ['en', 'es'] },
        chatSettings: {
          unknownInformationMessage: UNKNOWN,
          translations: {
            en: { welcomeMessage: 'Hello!', unknownInformationMessage: UNKNOWN },
            es: { welcomeMessage: '¡Hola!', unknownInformationMessage: 'No lo sé.' },
          },
        },
      } as unknown as UIDLAIAssistantChat)

      const answeredMultilingual = coverageHelper(multilingual)
      expect(answeredMultilingual(UNKNOWN)).toBe(false)
      expect(answeredMultilingual('No lo sé.')).toBe(false)
      expect(answeredMultilingual('Vendemos vestidos de novia.')).toBe(true)
    })
  })
})
