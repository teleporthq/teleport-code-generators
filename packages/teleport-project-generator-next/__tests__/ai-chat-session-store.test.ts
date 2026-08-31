import { generateAIChatSessionStoreCode } from '../src/ai-chat/session-store'

/**
 * The generated store keeps the conversation alive between pages. These run
 * the emitted module for real, because everything that matters about it is
 * runtime behaviour: what survives a link click, what survives the language
 * switcher's full page load, and what a refresh is supposed to throw away.
 */

interface SessionStoreModule {
  restoreAIChatMessages: (fallback: unknown) => unknown
  restoreAIChatConversationId: (fallback: string) => string
  persistAIChatSession: (messages: unknown, conversationId: unknown) => void
  clearAIChatSession: () => void
}

/** A sessionStorage that behaves like the browser's, shared across documents. */
class FakeStorage {
  public throwOnWrite = false
  private data: Record<string, string> = {}

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.data, key) ? this.data[key] : null
  }

  setItem(key: string, value: string): void {
    if (this.throwOnWrite) {
      throw new Error('QuotaExceededError')
    }
    this.data[key] = value
  }

  removeItem(key: string): void {
    delete this.data[key]
  }
}

type NavigationKind = 'navigate' | 'reload' | 'back_forward'

/**
 * Evaluates the emitted module as ONE document: a fresh module scope and a
 * fresh `globalThis`, over a sessionStorage that outlives it.
 */
const loadDocument = (
  storage: FakeStorage,
  navigationType: NavigationKind = 'navigate'
): SessionStoreModule => {
  const source = generateAIChatSessionStoreCode()
    .replace(/export function/g, 'function')
    .concat(
      '\nreturn { restoreAIChatMessages, restoreAIChatConversationId, persistAIChatSession, clearAIChatSession }'
    )
  const windowValue = { sessionStorage: storage }
  const performanceValue = {
    getEntriesByType: (kind: string) => (kind === 'navigation' ? [{ type: navigationType }] : []),
  }
  // eslint-disable-next-line no-new-func
  return new Function('window', 'globalThis', 'performance', source)(
    windowValue,
    {},
    performanceValue
  ) as SessionStoreModule
}

const WELCOME = [{ id: 'welcome_msg', sender: 'ai', message: 'Hi!', status: 'sent' }]
const TRANSCRIPT = [
  ...WELCOME,
  { id: 'm2', sender: 'user', message: 'How many products?', status: 'sent' },
]

describe('the emitted module itself', () => {
  it('is complete JavaScript', () => {
    // A bare backtick in the generated source terminates the template literal
    // that builds it, truncating the module mid-function — which then fails at
    // runtime in the visitor's browser and nowhere else.
    const source = generateAIChatSessionStoreCode()

    expect(() => {
      // eslint-disable-next-line no-new-func
      new Function('window', 'globalThis', 'performance', source.replace(/export /g, ''))
    }).not.toThrow()
    expect(source).toContain('function clearAIChatSession')
    expect(source.trimEnd().endsWith('}')).toBe(true)
  })

  it('clears a stored conversation as soon as it is loaded after a refresh', () => {
    // The purge runs at module load precisely so a page WITHOUT the chat still
    // ends the conversation when it is refreshed.
    const storage = new FakeStorage()
    loadDocument(storage).persistAIChatSession(TRANSCRIPT, 'conv-1')
    expect(storage.getItem('tq-ai-chat-session')).not.toBeNull()

    loadDocument(storage, 'reload')

    expect(storage.getItem('tq-ai-chat-session')).toBeNull()
  })
})

describe('carrying the conversation between pages', () => {
  it('hands back the welcome message on the first page of a visit', () => {
    const store = loadDocument(new FakeStorage())

    expect(store.restoreAIChatMessages(WELCOME)).toBe(WELCOME)
    expect(store.restoreAIChatConversationId('')).toBe('')
  })

  it('survives a link click, which never leaves the document', () => {
    const store = loadDocument(new FakeStorage())

    store.persistAIChatSession(TRANSCRIPT, 'conv-1')

    expect(store.restoreAIChatMessages(WELCOME)).toEqual(TRANSCRIPT)
    expect(store.restoreAIChatConversationId('')).toBe('conv-1')
  })

  it('survives the language switcher, which loads a whole new document', () => {
    // `<a href="/es">` tears down the JavaScript context, so an in-memory bag
    // alone loses the conversation exactly when the visitor changes language.
    const storage = new FakeStorage()
    loadDocument(storage).persistAIChatSession(TRANSCRIPT, 'conv-1')

    const afterLocaleSwitch = loadDocument(storage, 'navigate')

    expect(afterLocaleSwitch.restoreAIChatMessages(WELCOME)).toEqual(TRANSCRIPT)
    expect(afterLocaleSwitch.restoreAIChatConversationId('')).toBe('conv-1')
  })

  it('survives going back and forward', () => {
    const storage = new FakeStorage()
    loadDocument(storage).persistAIChatSession(TRANSCRIPT, 'conv-1')

    const afterBack = loadDocument(storage, 'back_forward')

    expect(afterBack.restoreAIChatMessages(WELCOME)).toEqual(TRANSCRIPT)
  })

  it('starts a new conversation on a refresh', () => {
    const storage = new FakeStorage()
    loadDocument(storage).persistAIChatSession(TRANSCRIPT, 'conv-1')

    const afterReload = loadDocument(storage, 'reload')

    expect(afterReload.restoreAIChatMessages(WELCOME)).toBe(WELCOME)
    expect(afterReload.restoreAIChatConversationId('')).toBe('')
  })

  it('does not resurrect the conversation on the page after a refresh', () => {
    const storage = new FakeStorage()
    loadDocument(storage).persistAIChatSession(TRANSCRIPT, 'conv-1')
    loadDocument(storage, 'reload')

    // The reload cleared storage, so navigating on has nothing to restore.
    expect(loadDocument(storage, 'navigate').restoreAIChatMessages(WELCOME)).toBe(WELCOME)
  })

  it('starts clean in a second tab', () => {
    const firstTab = new FakeStorage()
    loadDocument(firstTab).persistAIChatSession(TRANSCRIPT, 'conv-1')

    // sessionStorage is per tab, so a new tab gets its own empty one.
    expect(loadDocument(new FakeStorage()).restoreAIChatMessages(WELCOME)).toBe(WELCOME)
  })
})

describe('what the store refuses to carry', () => {
  it('keeps the id with the messages, so the server appends to the same row', () => {
    const storage = new FakeStorage()
    const store = loadDocument(storage)
    store.persistAIChatSession(TRANSCRIPT, 'conv-1')

    store.clearAIChatSession()

    // Restoring one without the other would show a history the database does
    // not have, or answer with no visible context.
    expect(store.restoreAIChatMessages(WELCOME)).toBe(WELCOME)
    expect(store.restoreAIChatConversationId('')).toBe('')
    expect(loadDocument(storage).restoreAIChatMessages(WELCOME)).toBe(WELCOME)
  })

  it('does not carry a chat nobody has used yet', () => {
    const storage = new FakeStorage()

    loadDocument(storage).persistAIChatSession(WELCOME, '')

    // Only the welcome bubble: a fresh tab should feel fresh, not resumed.
    expect(storage.getItem('tq-ai-chat-session')).toBeNull()
  })

  it('falls back rather than restoring an empty conversation', () => {
    const store = loadDocument(new FakeStorage())

    store.persistAIChatSession([], '')

    expect(store.restoreAIChatMessages(WELCOME)).toBe(WELCOME)
    expect(store.restoreAIChatConversationId('fresh')).toBe('fresh')
  })

  it('starts clean when the stored transcript is corrupt', () => {
    const storage = new FakeStorage()
    storage.setItem('tq-ai-chat-session', '{not json')

    expect(loadDocument(storage).restoreAIChatMessages(WELCOME)).toBe(WELCOME)
    expect(storage.getItem('tq-ai-chat-session')).toBeNull()
  })
})

describe('when the browser will not cooperate', () => {
  it('keeps working in-document when storage writes throw', () => {
    // Safari private mode throws on setItem; losing the cross-document
    // hand-off is survivable, throwing inside a render is not.
    const storage = new FakeStorage()
    storage.throwOnWrite = true
    const store = loadDocument(storage)

    expect(() => store.persistAIChatSession(TRANSCRIPT, 'conv-1')).not.toThrow()
    expect(store.restoreAIChatMessages(WELCOME)).toEqual(TRANSCRIPT)
  })

  it('treats a missing performance API as an ordinary navigation', () => {
    const storage = new FakeStorage()
    loadDocument(storage).persistAIChatSession(TRANSCRIPT, 'conv-1')

    const source = generateAIChatSessionStoreCode()
      .replace(/export function/g, 'function')
      .concat('\nreturn { restoreAIChatMessages }')
    // eslint-disable-next-line no-new-func
    const store = new Function('window', 'globalThis', 'performance', source)(
      { sessionStorage: storage },
      {},
      undefined
    ) as { restoreAIChatMessages: (f: unknown) => unknown }

    expect(store.restoreAIChatMessages(WELCOME)).toEqual(TRANSCRIPT)
  })
})

describe('the chat session store during server rendering', () => {
  const loadOnServer = (): SessionStoreModule => {
    const source = generateAIChatSessionStoreCode()
      .replace(/export function/g, 'function')
      .concat(
        '\nreturn { restoreAIChatMessages, restoreAIChatConversationId, persistAIChatSession, clearAIChatSession }'
      )
    // eslint-disable-next-line no-new-func
    return new Function('globalThis', `var window = undefined;\n${source}`)(
      {}
    ) as SessionStoreModule
  }

  it('never reads a global one visitor could share with another', () => {
    const store = loadOnServer()

    // One Node process serves everybody: a conversation cached here would be
    // rendered into a stranger's HTML.
    expect(store.restoreAIChatMessages(WELCOME)).toBe(WELCOME)
    expect(store.restoreAIChatConversationId('')).toBe('')
  })

  it('ignores a write instead of throwing mid-render', () => {
    const store = loadOnServer()

    expect(() => store.persistAIChatSession(TRANSCRIPT, 'conv-1')).not.toThrow()
    expect(store.restoreAIChatMessages(WELCOME)).toBe(WELCOME)
  })
})
