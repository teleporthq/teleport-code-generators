import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_speech_to_text(config: any) {
  const lang = config.lang || 'en-US'
  const continuous = config.continuous || false
  const interimResults = config.interimResults || false

  try {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      return {
        transcript: '',
        confidence: 0,
        isFinal: false,
        error: 'Speech recognition is not supported',
      }
    }

    const result = await new Promise<any>((resolve, reject) => {
      const recognition = new SpeechRecognition()
      recognition.lang = lang
      recognition.continuous = continuous
      recognition.interimResults = interimResults

      recognition.onresult = (event: any) => {
        const last = event.results[event.results.length - 1]
        const transcript = last[0].transcript
        const confidence = last[0].confidence
        const isFinal = last.isFinal
        recognition.stop()
        resolve({ transcript, confidence, isFinal })
      }

      recognition.onerror = (event: any) => {
        reject(new Error(event.error || 'Speech recognition failed'))
      }

      recognition.onnomatch = () => {
        resolve({ transcript: '', confidence: 0, isFinal: true })
      }

      recognition.start()
    })

    return result
  } catch (err: unknown) {
    return { transcript: '', confidence: 0, isFinal: false, error: (err as Error).message }
  }
}
export const browserSpeechToText: NodeHandlerGenerator = {
  nodeType: 'browser-speech-to-text',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_speech_to_text)
  },
}
