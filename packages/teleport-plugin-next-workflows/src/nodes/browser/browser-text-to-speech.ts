import { NodeHandlerGenerator, handlerToString } from '../types'

async function browser_text_to_speech(config: any) {
  const text = config.text || ''
  const lang = config.lang || 'en-US'
  const rate = config.rate != null ? config.rate : 1
  const pitch = config.pitch != null ? config.pitch : 1
  const volume = config.volume != null ? config.volume : 1

  try {
    if (!('speechSynthesis' in window)) {
      return { success: false, error: 'Speech synthesis is not supported' }
    }

    const result = await new Promise<{ success: boolean }>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = lang
      utterance.rate = rate
      utterance.pitch = pitch
      utterance.volume = volume

      utterance.onend = () => resolve({ success: true })
      utterance.onerror = (event: SpeechSynthesisErrorEvent) =>
        reject(new Error(event.error || 'Speech synthesis failed'))

      speechSynthesis.speak(utterance)
    })

    return result
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message }
  }
}
export const browserTextToSpeech: NodeHandlerGenerator = {
  nodeType: 'browser-text-to-speech',
  executionEnv: 'client',
  generateHandler(): string {
    return handlerToString(browser_text_to_speech)
  },
}
