import { GeneratedFolder } from '@teleporthq/teleport-types'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'
import { buildAIChatProjectUidl, findGeneratedFile } from './_helpers/ai-chat-project-uidl'

/**
 * Pins the conversation-persistence plugin against the REAL generator.
 *
 * Every gate in that plugin is a silent no-op — a shape it does not recognise
 * simply leaves the component untouched — so a drift in how state hooks are
 * emitted would quietly turn persistence off and no unit test would notice.
 * Running the whole pipeline is the only thing that catches it.
 *
 * The hydration rule this shape exists to satisfy lives in
 * `ai-chat-hydration-safety.test.ts`.
 */

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

const buildUidl = buildAIChatProjectUidl
const findFile = findGeneratedFile

describe('a generated chat that survives client-side navigation', () => {
  const generator = createNextProjectGenerator()

  it('restores both halves of the conversation and mirrors them back', async () => {
    const outputFolder = await generator.generateProject(buildUidl(false), template)
    const component = findFile(outputFolder, ['components'], 'ai-assistant-chat')

    // Restoration happens on mount, never during render — see the hydration
    // test below for why that is the whole point.
    expect(component?.content).toMatch(/const restoredChatMessages = restoreAIChatMessages\(null\)/)
    expect(component?.content).toMatch(
      /const restoredChatConversationId = restoreAIChatConversationId\(null\)/
    )
    expect(component?.content).toContain('if (restoredChatMessages) {')
    expect(component?.content).toContain('setChatMessages(restoredChatMessages)')
    // Mirroring both together is what keeps the restored transcript and the
    // row the server appends to in agreement.
    expect(component?.content).toContain('persistAIChatSession(chatMessages, chatConversationId)')
    expect(component?.content).toContain('}, [chatMessages, chatConversationId])')
  })

  it('never lets the mount write erase the session it is about to restore', async () => {
    const outputFolder = await generator.generateProject(buildUidl(false), template)
    const component = findFile(outputFolder, ['components'], 'ai-assistant-chat')

    // ⛔ The persist effect fires on mount, BEFORE the restore effect's setState
    // has committed, so it would hand `persistAIChatSession` the empty initial
    // state — and that helper clears storage for a welcome-only transcript.
    // Skipping the first run is what keeps the hand-off intact.
    expect(component?.content).toContain('const __aiChatSessionRestored = useRef(false)')
    expect(component?.content).toMatch(
      /if \(!__aiChatSessionRestored\.current\) \{\s*__aiChatSessionRestored\.current = true\s*return\s*\}/
    )
    expect(component?.content).toMatch(/import .*\buseRef\b.* from 'react'/)
  })

  it('imports the store the project actually emits', async () => {
    const outputFolder = await generator.generateProject(buildUidl(false), template)

    const component = findFile(outputFolder, ['components'], 'ai-assistant-chat')
    expect(component?.content).toMatch(
      /import \{[^}]*restoreAIChatMessages[^}]*\} from '\.\.\/lib\/ai-chat\/session-store'/
    )

    const store = findFile(outputFolder, ['lib', 'ai-chat'], 'session-store')
    expect(store).toBeDefined()
    expect(store?.content).toContain('__tqAiChatSession')
    expect(store?.content).toContain("typeof window === 'undefined'")
    // sessionStorage carries the conversation through the full page load the
    // language switcher performs; the reload purge is what still ends it on a
    // refresh. localStorage would outlive the tab entirely.
    expect(store?.content).toContain('sessionStorage')
    expect(store?.content).toContain('purgeSessionOnReload()')
    expect(store?.content).not.toContain('localStorage')
  })

  it('runs the reload purge on every page, not only the ones with a chat', async () => {
    const outputFolder = await generator.generateProject(buildUidl(false), template)

    const app = findFile(outputFolder, ['pages'], '_app')
    // A refresh on a chat-less page must still end the conversation, so the
    // store has to be imported by the app shell.
    expect(app?.content).toContain("import '../lib/ai-chat/session-store'")
  })

  it('re-localizes a transcript restored from a page in another language', async () => {
    const outputFolder = await generator.generateProject(buildUidl(true), template)
    const component = findFile(outputFolder, ['components'], 'ai-assistant-chat')

    // Nesting order is the whole contract between the two chat plugins: the
    // localizer must wrap the restore, or a Spanish visitor arriving from an
    // English page keeps the English greeting.
    expect(component?.content).toMatch(/localizeAIChatMessages\(\s*restoreAIChatMessages\(/)
    // Both effects survive: one mirrors the session, one follows the locale.
    expect(component?.content).toContain('persistAIChatSession(chatMessages')
    expect(component?.content).toContain(
      'setChatMessages((prev) => localizeAIChatMessages(prev, __aiChatLocale))'
    )
  })

  it('leaves components that are not the chat alone', async () => {
    const outputFolder = await generator.generateProject(buildUidl(false), template)

    const otherComponents = (
      outputFolder.subFolders.find((sub) => sub.name === 'components')?.files ?? []
    ).filter((file) => file.name !== 'ai-assistant-chat')
    expect(otherComponents.length).toBeGreaterThan(0)
    for (const file of otherComponents) {
      expect(file.content).not.toContain('persistAIChatSession')
    }
  })
})
