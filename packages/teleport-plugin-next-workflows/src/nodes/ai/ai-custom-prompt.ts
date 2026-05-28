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

async function ai_custom_prompt(
  config: any,
  context: Record<string, unknown>,
  streamCallback?: any
) {
  const prompt = __ai_resolveTextField(config.prompt)
  if (!prompt) {
    return { error: true, message: 'Prompt is required', code: 'missing_prompt' }
  }

  const model = config.model || 'gpt-4o'
  let temperature = config.temperature !== undefined ? config.temperature : 0.7
  let maxTokens = config.maxTokens || 500
  if (typeof maxTokens === 'number' && maxTokens < 1) {
    maxTokens = 1
  }

  let token
  try {
    token = __ai_resolveToken(config.token)
  } catch (err: any) {
    return { error: true, message: err.message, code: 'authentication_error' }
  }

  const provider = __ai_detectProvider(model)
  temperature = __ai_clampTemperature(temperature, provider)

  let systemMessage = config.systemMessage ? __ai_resolveTextField(config.systemMessage) : undefined
  if (systemMessage === '') {
    systemMessage = undefined
  }

  const callParams = {
    provider,
    model,
    token,
    systemMessage,
    userMessage: prompt,
    temperature,
    maxTokens,
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
      response: result.content,
      model,
      usage: result.usage,
    }
  } catch (err: any) {
    return { error: true, message: err.message || String(err), code: 'provider_error' }
  }
}

export const aiCustomPrompt: NodeHandlerGenerator = {
  nodeType: 'ai-custom-prompt',
  executionEnv: 'server',
  dependencies: AI_PROVIDER_DEPENDENCIES,
  generateHandler(): string {
    return generateAIProviderUtils() + '\n\n' + ai_custom_prompt.toString()
  },
  generateServerHandler(): string {
    return generateAIStreamingProviderUtils() + '\n\n' + ai_custom_prompt.toString()
  },
}
