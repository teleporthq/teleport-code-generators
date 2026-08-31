import { parse } from '@babel/parser'
import { GeneratedFolder } from '@teleporthq/teleport-types'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'
import { buildAIChatProjectUidl, findGeneratedFile } from './_helpers/ai-chat-project-uidl'

/**
 * ⛔ The chat component's FIRST client render must equal the server's HTML.
 *
 * The session store is browser-only: on the server `restoreAIChatMessages`
 * returns its fallback, in the browser it returns the visitor's transcript out
 * of `sessionStorage`. Read during render — from a `useState` initializer, a
 * bare call in the body, anything React evaluates on the first pass — the two
 * renders disagree and React throws:
 *
 *   Hydration failed because the initial UI does not match what was rendered
 *   on the server.
 *
 * That is not cosmetic. React discards the server markup and re-renders the
 * whole root, and in the generated app it surfaced as an unhandled runtime
 * error the moment a visitor followed a product link out of the chat — the one
 * navigation guaranteed to carry a conversation onto a page that also has the
 * chat on it.
 *
 * It shipped once already, and it shipped by accident: the restore lived in the
 * `useState` initializer back when the store was a `globalThis` bag, where a
 * document load genuinely did start empty. Adding `sessionStorage` made the
 * store outlive the document and silently invalidated that reasoning without
 * touching the plugin. This test states the rule the plugin can no longer be
 * trusted to keep on its own: NOTHING the store exports may be reached during
 * render, whatever the store happens to be built on this week.
 */

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

/** Every browser-only reader the session store exposes. */
const RENDER_UNSAFE_IDENTIFIERS = ['restoreAIChatMessages', 'restoreAIChatConversationId']

const chatComponentSource = async (localized: boolean): Promise<string> => {
  const generator = createNextProjectGenerator()
  const outputFolder = await generator.generateProject(buildAIChatProjectUidl(localized), template)
  const file = findGeneratedFile(outputFolder, ['components'], 'ai-assistant-chat')
  if (!file) {
    throw new Error('generated chat component not found')
  }
  return file.content
}

interface Node {
  type: string
  [key: string]: unknown
}

/** Depth-first walk that yields every node, carrying the enclosing arrow chain. */
const walk = (
  node: unknown,
  visit: (node: Node, ancestors: Node[]) => void,
  stack: Node[] = []
) => {
  if (!node || typeof node !== 'object') {
    return
  }
  if (Array.isArray(node)) {
    node.forEach((entry) => walk(entry, visit, stack))
    return
  }
  const candidate = node as Node
  if (typeof candidate.type !== 'string') {
    return
  }
  visit(candidate, stack)
  const nextStack = [...stack, candidate]
  for (const key of Object.keys(candidate)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') {
      continue
    }
    walk(candidate[key], visit, nextStack)
  }
}

/**
 * Every call to one of `identifiers`, paired with whether it sits inside a
 * function passed to `useEffect` — the only place a browser-only read is safe.
 */
const findStoreReads = (source: string) => {
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
  const reads: Array<{ name: string; insideEffect: boolean }> = []

  walk(ast.program, (node, ancestors) => {
    if (node.type !== 'CallExpression') {
      return
    }
    const callee = node.callee as Node | undefined
    if (!callee || callee.type !== 'Identifier') {
      return
    }
    const name = callee.name as string
    if (!RENDER_UNSAFE_IDENTIFIERS.includes(name)) {
      return
    }
    // Walking outwards: the nearest enclosing function must be the callback of
    // a useEffect call, i.e. deferred past the first render.
    const insideEffect = ancestors.some(
      (ancestor) =>
        ancestor.type === 'CallExpression' &&
        (ancestor.callee as Node | undefined)?.type === 'Identifier' &&
        ((ancestor.callee as Node).name as string) === 'useEffect'
    )
    reads.push({ name, insideEffect })
  })

  return reads
}

describe.each([
  ['a single-language project', false],
  ['a localized project', true],
])('the generated chat hydrates cleanly — %s', (_label, localized) => {
  it('never reads the session store during render', async () => {
    const source = await chatComponentSource(localized)
    const reads = findStoreReads(source)

    // The plugin must actually have run, or this test would pass vacuously.
    expect(reads.length).toBeGreaterThan(0)

    const duringRender = reads.filter((read) => !read.insideEffect)
    expect(duringRender).toEqual([])
  })

  it('keeps every useState initializer free of browser-only values', async () => {
    const source = await chatComponentSource(localized)
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
    const offenders: string[] = []

    walk(ast.program, (node) => {
      if (node.type !== 'CallExpression') {
        return
      }
      const callee = node.callee as Node | undefined
      if (callee?.type !== 'Identifier' || (callee.name as string) !== 'useState') {
        return
      }
      walk(node.arguments, (inner) => {
        if (inner.type !== 'Identifier') {
          return
        }
        if (RENDER_UNSAFE_IDENTIFIERS.includes(inner.name as string)) {
          offenders.push(inner.name as string)
        }
      })
    })

    expect(offenders).toEqual([])
  })
})
