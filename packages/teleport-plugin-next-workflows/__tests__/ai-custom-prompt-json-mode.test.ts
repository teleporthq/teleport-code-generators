import { aiCustomPrompt } from '../src/nodes/ai/ai-custom-prompt'

/**
 * `ai-custom-prompt` used to hard-code `jsonMode: false`, so a node whose only
 * job is to emit a machine-readable decision (the AI Assistant Chat's tool
 * router) had no way to ask the provider for a JSON-only reply. The flag is now
 * forwarded from the node config.
 *
 * The generated provider utils are emitted as
 * `var __ai_callProvider = typeof __ai_callProvider !== 'undefined' ? … : <def>`,
 * so defining the name ahead of the handler source substitutes a spy for the
 * real provider call.
 */
type ProviderCall = { jsonMode?: boolean; systemMessage?: string; userMessage?: string }
type PromptHandler = (
  config: Record<string, unknown>,
  context: Record<string, unknown>,
  streamCallback?: unknown
) => Promise<Record<string, unknown>>

function loadHandlerWithProviderSpy(): { handler: PromptHandler; calls: ProviderCall[] } {
  const calls: ProviderCall[] = []
  const source = aiCustomPrompt.generateHandler()
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    '__calls',
    [
      'var __ai_callProvider = function (params) {',
      '  __calls.push(params);',
      '  return Promise.resolve({ content: \'{"action":"none"}\', usage: { total_tokens: 3 } });',
      '};',
      source,
      'return ai_custom_prompt;',
    ].join('\n')
  )
  return { handler: factory(calls) as PromptHandler, calls }
}

describe('ai-custom-prompt jsonMode passthrough', () => {
  it('asks the provider for JSON when the node config sets jsonMode', async () => {
    const { handler, calls } = loadHandlerWithProviderSpy()

    const result = await handler({ prompt: 'Decide.', token: 'sk-test', jsonMode: true }, {})

    expect(calls).toHaveLength(1)
    expect(calls[0].jsonMode).toBe(true)
    expect(result.response).toBe('{"action":"none"}')
  })

  it('leaves JSON mode off for an ordinary prompt node', async () => {
    const { handler, calls } = loadHandlerWithProviderSpy()

    await handler({ prompt: 'Write a haiku.', token: 'sk-test' }, {})

    expect(calls[0].jsonMode).toBe(false)
  })

  it('treats any non-true value as off, so a stale string config cannot enable it', async () => {
    const { handler, calls } = loadHandlerWithProviderSpy()

    await handler({ prompt: 'Hi.', token: 'sk-test', jsonMode: 'true' }, {})

    expect(calls[0].jsonMode).toBe(false)
  })

  it('never sends jsonMode down the streaming path', async () => {
    const { handler, calls } = loadHandlerWithProviderSpy()
    const chunks: string[] = []

    // No stream callback => the streaming branch is skipped; with one, the
    // handler must not reach __ai_callProvider at all.
    await handler({ prompt: 'Hi.', token: 'sk-test', jsonMode: true, streaming: true }, {}, () =>
      chunks.push('x')
    )

    expect(calls).toHaveLength(0)
  })
})
