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

async function ai_sentiment_analysis(
  config: any,
  context: Record<string, unknown>,
  streamCallback?: any
) {
  const text = __ai_resolveTextField(config.text)
  const outputFormat = config.outputFormat || 'detailed'
  const model = config.model || 'gpt-4o'

  if (!text) {
    if (outputFormat === 'simple') {
      return { sentiment: 'neutral' }
    }
    if (outputFormat === 'score') {
      return { score: 0 }
    }
    return {
      sentiment: 'neutral',
      confidence: 0,
      scores: { positive: 0, negative: 0, neutral: 1 },
    }
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
  if (outputFormat === 'simple') {
    systemPrompt =
      'Analyze the sentiment of the following text. Respond with ONLY a JSON object: { "sentiment": "positive" | "negative" | "neutral" }'
  } else if (outputFormat === 'score') {
    systemPrompt =
      'Analyze the sentiment of the following text. Respond with ONLY a JSON object: { "score": number } where score ranges from -1 (very negative) to 1 (very positive)'
  } else {
    systemPrompt =
      'Analyze the sentiment of the following text. Respond with ONLY a JSON object: { "sentiment": "positive" | "negative" | "neutral", "confidence": number_0_to_1, "scores": { "positive": number_0_to_1, "negative": number_0_to_1, "neutral": number_0_to_1 } }'
  }

  const callParams = {
    provider,
    model,
    token,
    systemMessage: systemPrompt,
    userMessage: text,
    temperature,
    maxTokens: 200,
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
      const lower = (result.content || '').toLowerCase()
      let sentiment = 'neutral'
      if (lower.indexOf('positive') >= 0) {
        sentiment = 'positive'
      } else if (lower.indexOf('negative') >= 0) {
        sentiment = 'negative'
      }

      if (outputFormat === 'simple') {
        return { sentiment }
      }
      if (outputFormat === 'score') {
        return {
          score: sentiment === 'positive' ? 0.5 : sentiment === 'negative' ? -0.5 : 0,
        }
      }
      return {
        sentiment,
        confidence: 0.5,
        scores: {
          positive: sentiment === 'positive' ? 0.5 : 0.1,
          negative: sentiment === 'negative' ? 0.5 : 0.1,
          neutral: sentiment === 'neutral' ? 0.5 : 0.1,
        },
      }
    }

    if (outputFormat === 'simple') {
      return { sentiment: parsed.sentiment || 'neutral' }
    }
    if (outputFormat === 'score') {
      return { score: typeof parsed.score === 'number' ? parsed.score : 0 }
    }

    const validSentiments = ['positive', 'negative', 'neutral']
    const s = validSentiments.indexOf(parsed.sentiment) >= 0 ? parsed.sentiment : 'neutral'
    return {
      sentiment: s,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
      scores: {
        positive:
          parsed.scores && typeof parsed.scores.positive === 'number' ? parsed.scores.positive : 0,
        negative:
          parsed.scores && typeof parsed.scores.negative === 'number' ? parsed.scores.negative : 0,
        neutral:
          parsed.scores && typeof parsed.scores.neutral === 'number' ? parsed.scores.neutral : 0,
      },
    }
  } catch (err: any) {
    return { error: true, message: err.message || String(err), code: 'provider_error' }
  }
}

export const aiSentimentAnalysis: NodeHandlerGenerator = {
  nodeType: 'ai-sentiment-analysis',
  executionEnv: 'server',
  dependencies: AI_PROVIDER_DEPENDENCIES,
  generateHandler(): string {
    return generateAIProviderUtils() + '\n\n' + ai_sentiment_analysis.toString()
  },
  generateServerHandler(): string {
    return generateAIStreamingProviderUtils() + '\n\n' + ai_sentiment_analysis.toString()
  },
}
