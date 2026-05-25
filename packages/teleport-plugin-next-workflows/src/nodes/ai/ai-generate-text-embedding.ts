import { NodeHandlerGenerator } from '../types'
import { generateAIProviderUtils, AI_PROVIDER_DEPENDENCIES } from './ai-provider-utils'

declare function __ai_resolveTextField(val: any): string
declare function __ai_resolveToken(token: any): string

async function ai_generate_text_embedding(config: any, context: Record<string, unknown>) {
  const text = __ai_resolveTextField(config.text)
  if (!text) {
    return { error: true, message: 'Text to embed is required', code: 'missing_text' }
  }

  let token
  try {
    token = __ai_resolveToken(config.token)
  } catch (err: any) {
    return { error: true, message: err.message, code: 'authentication_error' }
  }

  const model = config.model || 'text-embedding-3-small'
  const encodingFormat = config.encodingFormat || 'float'

  try {
    const _mod = require('openai')
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
      return { error: true, message: 'No embedding returned from API', code: 'empty_response' }
    }

    const usage = response.usage || {}
    return {
      embedding: embeddingData.embedding,
      model: response.model || model,
      dimensions: embeddingData.embedding.length,
      usage: {
        promptTokens: usage.prompt_tokens || 0,
        totalTokens: usage.total_tokens || 0,
      },
    }
  } catch (err: any) {
    return { error: true, message: err.message || String(err), code: 'provider_error' }
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
