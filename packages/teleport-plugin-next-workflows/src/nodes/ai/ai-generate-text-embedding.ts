import { NodeHandlerGenerator } from '../types'
import { generateAIProviderUtils, AI_PROVIDER_DEPENDENCIES } from './ai-provider-utils'

declare function __ai_resolveTextField(val: any): string
declare function __ai_resolveToken(token: any): string

/**
 * Text embeddings, always through OpenAI's embeddings API.
 *
 * ## `config.optional`
 *
 * A node result carrying `error: true` is FATAL — `isFatalNodeResult` in the
 * executor throws on it and the whole workflow stops. That is right for a
 * pipeline whose output is the embedding, and wrong for one where the
 * embedding only powers a nice-to-have branch.
 *
 * The AI Assistant Chat is the second case: its retrieval is a hybrid of a
 * vector search and a keyword search running in parallel, and the keyword half
 * answers perfectly well on its own. A chat whose provider is Anthropic or
 * Google may legitimately have no OpenAI key at all (embeddings are OpenAI-only
 * because that is what the knowledge base was indexed with), and that must
 * degrade to keyword-only search rather than break every message.
 *
 * With `optional: true` the node reports failure as data — `skipped: true` plus
 * an empty `embedding` — so downstream nodes can branch on it. Consumers must
 * check `embedding.length` before using it, which the chat's semantic-query
 * builder already does.
 */
async function ai_generate_text_embedding(config: any, context: Record<string, unknown>) {
  const optional = config.optional === true

  function fail(message: string, code: string) {
    if (optional) {
      return {
        embedding: [],
        vectorLiteral: '',
        dimensions: 0,
        skipped: true,
        skipReason: message,
        code,
      }
    }
    return { error: true, message, code }
  }

  const text = __ai_resolveTextField(config.text)
  if (!text) {
    return fail('Text to embed is required', 'missing_text')
  }

  let token
  try {
    token = __ai_resolveToken(config.token)
  } catch (err: any) {
    return fail(err.message, 'authentication_error')
  }

  const model = config.model || 'text-embedding-3-small'
  const encodingFormat = config.encodingFormat || 'float'

  try {
    const __nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const _mod = __nodeRequire('openai')
    const OpenAI = _mod.default || _mod
    const client = new OpenAI({ apiKey: token })

    const requestOpts: any = {
      model,
      input: text,
      encoding_format: encodingFormat,
    }
    if (config.dimensions && typeof config.dimensions === 'number' && config.dimensions > 0) {
      requestOpts.dimensions = config.dimensions
    }

    const response = await client.embeddings.create(requestOpts)

    const embeddingData = response.data && response.data[0]
    if (!embeddingData || !embeddingData.embedding) {
      return fail('No embedding returned from API', 'empty_response')
    }

    const usage = response.usage || {}
    return {
      embedding: embeddingData.embedding,
      // pgvector's literal form, ready to bind as a `$N` param and cast with
      // `::vector`. The raw `embedding` array cannot do that job: a JS array
      // bound as a query parameter is serialized as a Postgres ARRAY literal
      // (`{0.1,0.2}`), which no cast turns into a vector. Without this field a
      // vector search has to assemble its SQL in a general-custom-js node —
      // whose output is relayed to the browser, leaking the schema.
      vectorLiteral: '[' + embeddingData.embedding.join(',') + ']',
      model: response.model || model,
      dimensions: embeddingData.embedding.length,
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      },
    }
  } catch (err: any) {
    return fail(err.message || String(err), 'provider_error')
  }
}

export const aiGenerateTextEmbedding: NodeHandlerGenerator = {
  nodeType: 'ai-generate-text-embedding',
  executionEnv: 'server',
  dependencies: { openai: AI_PROVIDER_DEPENDENCIES.openai },
  generateHandler(): string {
    return generateAIProviderUtils() + '\n\n' + ai_generate_text_embedding.toString()
  },
}
