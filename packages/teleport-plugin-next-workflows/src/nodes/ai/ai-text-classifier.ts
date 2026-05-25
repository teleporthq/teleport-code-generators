import { NodeHandlerGenerator } from '../types'
import {
  generateAIProviderUtils,
  generateAIStreamingProviderUtils,
  AI_PROVIDER_DEPENDENCIES,
} from './ai-provider-utils'

declare function __ai_resolveTextField(val: any): string
declare function __ai_resolveToken(token: any): string
declare function __ai_detectProvider(modelId: any): string
declare function __ai_clampTemperature(temp: any, provider: string): number
declare function __ai_callProvider(params: any): Promise<any>
declare function __ai_parseJSON(text: any): any
declare function __ai_handleStreamingCall(
  callParams: any,
  model: string,
  streamCallback: any
): Promise<any>

async function ai_text_classifier(
  config: any,
  context: Record<string, unknown>,
  streamCallback?: any
) {
  const text = __ai_resolveTextField(config.text)
  const model = config.model || 'gpt-4o'
  const mode = config.mode || 'single'

  const categories = config.categories
  if (!categories) {
    return { error: true, message: 'Categories are required', code: 'missing_categories' }
  }

  let categoryList
  if (Array.isArray(categories)) {
    categoryList = categories.join(', ')
  } else {
    categoryList = __ai_resolveTextField(categories)
  }

  if (!categoryList || !categoryList.trim()) {
    return { error: true, message: 'Categories are required', code: 'missing_categories' }
  }

  if (!text) {
    if (mode === 'multiple') {
      return { categories: [] }
    }
    return { category: 'unknown', confidence: 0 }
  }

  let token
  try {
    token = __ai_resolveToken(config.token)
  } catch (err: any) {
    return { error: true, message: err.message, code: 'authentication_error' }
  }

  const provider = __ai_detectProvider(model)
  const temperature = __ai_clampTemperature(0, provider)

  let systemPrompt
  if (mode === 'multiple') {
    systemPrompt =
      'Classify the following text. It may belong to MULTIPLE of these categories: ' +
      categoryList +
      '. Respond with ONLY a JSON object: { "categories": [{ "category": "name", "confidence": number_0_to_1 }] }. Include all matching categories with confidence > 0.3. Sort by confidence descending.'
  } else {
    systemPrompt =
      'Classify the following text into exactly ONE of these categories: ' +
      categoryList +
      '. Respond with ONLY a JSON object: { "category": "chosen_category", "confidence": number_0_to_1 }'
  }

  const callParams = {
    provider,
    model,
    token,
    systemMessage: systemPrompt,
    userMessage: text,
    temperature,
    maxTokens: 300,
  }

  if (config.streaming && streamCallback) {
    try {
      return await __ai_handleStreamingCall(callParams, model, streamCallback)
    } catch (err: any) {
      return { error: true, message: err.message || String(err), code: 'provider_error' }
    }
  }

  try {
    const result = await __ai_callProvider({ ...callParams, jsonMode: provider === 'openai' })

    const parsed = __ai_parseJSON(result.content)

    if (!parsed) {
      if (mode === 'multiple') {
        return { categories: [] }
      }
      return { category: 'unknown', confidence: 0 }
    }

    if (mode === 'multiple') {
      let cats = parsed.categories
      if (!Array.isArray(cats)) {
        if (parsed.category) {
          cats = [
            {
              category: parsed.category,
              confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
            },
          ]
        } else {
          cats = []
        }
      }
      cats = cats.map(function (c: any) {
        return {
          category: c.category || 'unknown',
          confidence: typeof c.confidence === 'number' ? c.confidence : 0,
        }
      })
      cats.sort(function (a: any, b: any) {
        return b.confidence - a.confidence
      })
      return { categories: cats }
    }

    return {
      category: parsed.category || 'unknown',
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    }
  } catch (err: any) {
    return { error: true, message: err.message || String(err), code: 'provider_error' }
  }
}

export const aiTextClassifier: NodeHandlerGenerator = {
  nodeType: 'ai-text-classifier',
  executionEnv: 'server',
  dependencies: AI_PROVIDER_DEPENDENCIES,
  generateHandler(): string {
    return generateAIProviderUtils() + '\n\n' + ai_text_classifier.toString()
  },
  generateServerHandler(): string {
    return generateAIStreamingProviderUtils() + '\n\n' + ai_text_classifier.toString()
  },
}
