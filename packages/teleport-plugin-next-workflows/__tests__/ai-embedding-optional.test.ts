import { aiGenerateTextEmbedding } from '../src/nodes/ai/ai-generate-text-embedding'
import { generateSharedRuntimeUtilsCode } from '../src/executor-generator'

/**
 * `{ error: true }` is a FATAL node result — the generated executor throws on
 * it and the whole workflow stops. The AI Assistant Chat's embedding step must
 * not be fatal: its retrieval is a hybrid of a vector search and a keyword
 * search, and a project whose chat runs on Anthropic/Google/Mistral may
 * legitimately have no OpenAI key (embeddings are OpenAI-only because that is
 * what the knowledge base was indexed with). That has to degrade to
 * keyword-only search, not break every message.
 */
/** The real executor gate, loaded exactly as the generated app defines it. */
function loadIsFatalNodeResult(): (result: unknown) => boolean {
  const utilsModule = { exports: {} as { isFatalNodeResult: (result: unknown) => boolean } }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function('module', 'exports', 'require', generateSharedRuntimeUtilsCode())(
    utilsModule,
    utilsModule.exports,
    () => ({})
  )
  return utilsModule.exports.isFatalNodeResult
}

function loadHandler() {
  const source = aiGenerateTextEmbedding.generateHandler()
  // eslint-disable-next-line no-new-func
  return new Function(`${source}\nreturn ai_generate_text_embedding;`)() as (
    config: any,
    context: Record<string, unknown>
  ) => Promise<any>
}

describe('ai-generate-text-embedding failure contract', () => {
  const handler = loadHandler()

  it('is fatal by default, so a pipeline that needs the vector stops', async () => {
    const result = await handler({ text: 'hello', token: '' }, {})
    expect(result.error).toBe(true)
    expect(result.code).toBe('authentication_error')
  })

  it('reports failure as data when optional, so the workflow keeps running', async () => {
    const result = await handler({ text: 'hello', token: '', optional: true }, {})
    expect(result.error).toBeUndefined()
    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBeTruthy()
    expect(result.code).toBe('authentication_error')
  })

  it('returns an empty embedding when skipped, which is what hasEmbedding checks', async () => {
    const result = await handler({ text: 'hello', token: '', optional: true }, {})
    expect(Array.isArray(result.embedding)).toBe(true)
    expect(result.embedding).toHaveLength(0)
    expect(result.dimensions).toBe(0)
  })

  it('is non-fatal for missing text too, not just auth', async () => {
    const result = await handler({ text: '', token: 'sk-test', optional: true }, {})
    expect(result.error).toBeUndefined()
    expect(result.skipped).toBe(true)
    expect(result.code).toBe('missing_text')
  })
})

describe('the executor agrees about what is fatal', () => {
  const handler = loadHandler()
  const isFatalNodeResult = loadIsFatalNodeResult()

  it('treats the default failure as fatal and the optional one as success', async () => {
    const fatal = await handler({ text: 'hello', token: '' }, {})
    const optional = await handler({ text: 'hello', token: '', optional: true }, {})

    expect(isFatalNodeResult(fatal)).toBe(true)
    expect(isFatalNodeResult(optional)).toBe(false)
  })
})
