import { NodeHandlerGenerator } from '../types'
import {
  generateAIProviderUtils,
  generateAIStreamingProviderUtils,
  AI_PROVIDER_DEPENDENCIES,
} from './ai-provider-utils'

declare function __ai_resolveTextField(val: any): string
declare function __ai_resolveToken(token: any): string
declare function __ai_resolveProvider(config: any): string
declare function __ai_clampTemperature(temp: any, provider: string): number
declare function __ai_callProvider(params: any): Promise<any>
declare function __ai_parseJSON(text: any): any
declare function __ai_handleStreamingCall(
  callParams: any,
  model: string,
  streamCallback: any
): Promise<any>

async function ai_detect_language(
  config: any,
  context: Record<string, unknown>,
  streamCallback?: any
) {
  const text = __ai_resolveTextField(config.text)
  const model = config.model || 'gpt-4o'
  const outputFormat = config.outputFormat || 'code'

  if (!text) {
    if (outputFormat === 'detailed') {
      return { code: 'unknown', name: 'Unknown', confidence: 0 }
    }
    return { language: 'unknown' }
  }

  let token
  try {
    token = __ai_resolveToken(config.token)
  } catch (err: any) {
    return { error: true, message: err.message, code: 'authentication_error' }
  }

  const provider = __ai_resolveProvider(config)
  const temperature = __ai_clampTemperature(0, provider)

  let systemPrompt
  if (outputFormat === 'name') {
    systemPrompt =
      'Detect the language of the following text. Respond with ONLY a JSON object: { "language": "Full Language Name" }'
  } else if (outputFormat === 'detailed') {
    systemPrompt =
      'Detect the language of the following text. Respond with ONLY a JSON object: { "code": "ISO_639-1_code", "name": "Full Language Name", "confidence": number_0_to_1 }'
  } else {
    systemPrompt =
      'Detect the language of the following text. Respond with ONLY a JSON object: { "language": "ISO_639-1_code" }'
  }

  const callParams = {
    provider,
    model,
    token,
    systemMessage: systemPrompt,
    userMessage: text,
    temperature,
    maxTokens: 100,
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
      if (outputFormat === 'detailed') {
        return { code: 'unknown', name: 'Unknown', confidence: 0 }
      }
      return { language: 'unknown' }
    }

    if (outputFormat === 'detailed') {
      return {
        code: parsed.code || parsed.language || 'unknown',
        name: parsed.name || 'Unknown',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      }
    }

    return { language: parsed.language || parsed.code || 'unknown' }
  } catch (err: any) {
    return { error: true, message: err.message || String(err), code: 'provider_error' }
  }
}

export const aiDetectLanguage: NodeHandlerGenerator = {
  nodeType: 'ai-detect-language',
  executionEnv: 'server',
  dependencies: AI_PROVIDER_DEPENDENCIES,
  generateHandler(): string {
    return generateAIProviderUtils() + '\n\n' + ai_detect_language.toString()
  },
  generateServerHandler(): string {
    return generateAIStreamingProviderUtils() + '\n\n' + ai_detect_language.toString()
  },
}
