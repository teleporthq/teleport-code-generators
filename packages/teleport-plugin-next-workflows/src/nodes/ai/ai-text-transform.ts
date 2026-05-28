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
declare function __ai_handleStreamingCall(
  callParams: any,
  model: string,
  streamCallback: any
): Promise<any>

async function ai_text_transform(
  config: any,
  context: Record<string, unknown>,
  streamCallback?: any
) {
  const inputText = __ai_resolveTextField(config.inputText)
  const model = config.model || 'gpt-4o'
  const transformation = config.transformation || 'rephrase'
  const tone = config.tone || 'neutral'
  const targetLanguage = config.targetLanguage || 'es'

  if (!inputText) {
    return { result: '', model }
  }

  let token
  try {
    token = __ai_resolveToken(config.token)
  } catch (err: any) {
    return { error: true, message: err.message, code: 'authentication_error' }
  }

  const provider = __ai_detectProvider(model)
  const temperature = __ai_clampTemperature(0.3, provider)

  const langNames: Record<string, string> = {
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese',
    ru: 'Russian',
    ar: 'Arabic',
  }

  let systemPrompt
  if (transformation === 'simplify') {
    systemPrompt =
      'Simplify the following text to make it easier to understand. Use a ' + tone + ' tone.'
  } else if (transformation === 'formalize') {
    systemPrompt = 'Rewrite the following text in a formal, professional manner.'
  } else if (transformation === 'expand') {
    systemPrompt =
      'Expand on the following text, adding relevant detail and context. Use a ' + tone + ' tone.'
  } else if (transformation === 'shorten') {
    systemPrompt =
      'Condense the following text while preserving the key points. Use a ' + tone + ' tone.'
  } else if (transformation === 'translate') {
    const langName = langNames[targetLanguage] || targetLanguage
    systemPrompt =
      'Translate the following text to ' + langName + '. Preserve the original meaning and context.'
  } else if (transformation === 'fix-grammar') {
    systemPrompt =
      'Fix any grammatical errors in the following text. Do not change the meaning or style.'
  } else {
    systemPrompt =
      'Rephrase the following text while preserving its meaning. Use a ' + tone + ' tone.'
  }

  systemPrompt += ' Respond only with the transformed text, no other formatting or explanation.'

  const callParams = {
    provider,
    model,
    token,
    systemMessage: systemPrompt,
    userMessage: inputText,
    temperature,
    maxTokens: 1000,
  }

  if (config.streaming && streamCallback) {
    try {
      return await __ai_handleStreamingCall(callParams, model, streamCallback)
    } catch (err: any) {
      return { error: true, message: err.message || String(err), code: 'provider_error' }
    }
  }

  try {
    const result = await __ai_callProvider({ ...callParams, jsonMode: false })

    return {
      result: result.content || '',
      model,
    }
  } catch (err: any) {
    return { error: true, message: err.message || String(err), code: 'provider_error' }
  }
}

export const aiTextTransform: NodeHandlerGenerator = {
  nodeType: 'ai-text-transform',
  executionEnv: 'server',
  dependencies: AI_PROVIDER_DEPENDENCIES,
  generateHandler(): string {
    return generateAIProviderUtils() + '\n\n' + ai_text_transform.toString()
  },
  generateServerHandler(): string {
    return generateAIStreamingProviderUtils() + '\n\n' + ai_text_transform.toString()
  },
}
