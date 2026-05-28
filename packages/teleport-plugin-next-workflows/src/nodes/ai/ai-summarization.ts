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

async function ai_summarization(
  config: any,
  context: Record<string, unknown>,
  streamCallback?: any
) {
  const text = __ai_resolveTextField(config.text)
  const model = config.model || 'gpt-4o'

  if (!text) {
    return { summary: '', model }
  }

  let token
  try {
    token = __ai_resolveToken(config.token)
  } catch (err: any) {
    return { error: true, message: err.message, code: 'authentication_error' }
  }

  const provider = __ai_detectProvider(model)
  const temperature = __ai_clampTemperature(0.3, provider)

  const length = config.length || 'medium'
  const style = config.style || 'paragraph'
  const maxLength = config.maxLength
  const focusArea = config.focusArea

  let lengthInstruction
  if (maxLength && typeof maxLength === 'number') {
    lengthInstruction = 'Keep the summary under ' + maxLength + ' characters.'
  } else if (length === 'short') {
    lengthInstruction = 'Write a short summary (1-2 sentences, about 50 words).'
  } else if (length === 'long') {
    lengthInstruction = 'Write a detailed summary (multiple paragraphs, about 300 words).'
  } else {
    lengthInstruction = 'Write a medium-length summary (1 paragraph, about 150 words).'
  }

  let styleInstruction
  if (style === 'bullet-points') {
    styleInstruction = 'Format the summary as a bulleted list of key information.'
  } else if (style === 'key-points') {
    styleInstruction = 'Format the summary as a numbered list of the most important takeaways.'
  } else {
    styleInstruction = 'Format the summary as flowing prose.'
  }

  let systemPrompt = 'Summarize the following text. ' + lengthInstruction + ' ' + styleInstruction
  if (focusArea && typeof focusArea === 'string' && focusArea.trim()) {
    systemPrompt += ' Focus specifically on: ' + focusArea.trim() + '.'
  }
  systemPrompt += ' Respond only with the summary text, no other formatting or explanation.'

  const callParams = {
    provider,
    model,
    token,
    systemMessage: systemPrompt,
    userMessage: text,
    temperature,
    maxTokens: length === 'short' ? 200 : length === 'long' ? 1000 : 500,
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
      summary: result.content || '',
      model,
    }
  } catch (err: any) {
    return { error: true, message: err.message || String(err), code: 'provider_error' }
  }
}

export const aiSummarization: NodeHandlerGenerator = {
  nodeType: 'ai-summarization',
  executionEnv: 'server',
  dependencies: AI_PROVIDER_DEPENDENCIES,
  generateHandler(): string {
    return generateAIProviderUtils() + '\n\n' + ai_summarization.toString()
  },
  generateServerHandler(): string {
    return generateAIStreamingProviderUtils() + '\n\n' + ai_summarization.toString()
  },
}
