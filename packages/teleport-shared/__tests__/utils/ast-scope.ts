import { parse } from '@babel/parser'
import * as types from '@babel/types'
import { ASTScope } from '../../src'

const { collectBlockScopedBindings, collectReferencedIdentifiers } = ASTScope

const statementsOf = (code: string): types.Statement[] =>
  parse(code, { sourceType: 'module', plugins: ['jsx'] }).program.body as types.Statement[]

const firstStatement = (code: string): types.Statement => statementsOf(code)[0]

const refs = (code: string, options?: ASTScope.ReferenceOptions): string[] =>
  Array.from(collectReferencedIdentifiers(statementsOf(code), options)).sort()

describe('collectBlockScopedBindings', () => {
  it('collects let/const/class bindings, including destructuring patterns', () => {
    expect(collectBlockScopedBindings(firstStatement('const [a, setA] = useState(0)'))).toEqual([
      'a',
      'setA',
    ])
    expect(
      collectBlockScopedBindings(firstStatement('let { x, y: { z }, ...rest } = props'))
    ).toEqual(['x', 'z', 'rest'])
    expect(collectBlockScopedBindings(firstStatement('class Foo {}'))).toEqual(['Foo'])
  })

  it('excludes var and function declarations — they are hoisted, not TDZ-governed', () => {
    expect(collectBlockScopedBindings(firstStatement('var a = 1'))).toEqual([])
    expect(collectBlockScopedBindings(firstStatement('function foo() {}'))).toEqual([])
  })
})

describe('collectReferencedIdentifiers — what counts as a read', () => {
  it('collects plain reads and ignores declared names', () => {
    expect(refs('const a = b + c')).toEqual(['b', 'c'])
  })

  it('ignores object keys and non-computed member properties', () => {
    expect(refs('const p = { page: state.page, perPage: 20 }')).toEqual(['state'])
  })

  it('collects computed member properties and computed keys', () => {
    expect(refs('const v = obj[key]')).toEqual(['key', 'obj'])
    expect(refs('const o = { [name]: 1 }')).toEqual(['name'])
  })

  it('treats capitalized JSX tags as reads and intrinsic tags / attribute names as text', () => {
    expect(refs('const el = <Repeater items={rows} />')).toEqual(['Repeater', 'rows'])
    expect(refs('const el = <div className="x" />')).toEqual([])
  })

  it('collects default values read by destructuring patterns', () => {
    expect(refs('const { a = fallback } = props')).toEqual(['fallback', 'props'])
  })
})

describe('collectReferencedIdentifiers — immediate vs deferred', () => {
  it('skips reads inside function bodies by default (they run later)', () => {
    expect(refs('const handler = () => helper()')).toEqual([])
    expect(refs('function run() { return helper() }')).toEqual([])
  })

  it('collects deferred reads when includeDeferred is on', () => {
    expect(refs('const handler = () => helper()', { includeDeferred: true })).toEqual(['helper'])
  })

  it('sees through useMemo: both the callback and the deps array run with the statement', () => {
    expect(refs('const p = useMemo(() => ({ page: st.page }), [st])')).toEqual(['st', 'useMemo'])
    // Even with an empty deps array, the callback itself is invoked during render.
    expect(refs('const p = useMemo(() => st.page, [])')).toEqual(['st', 'useMemo'])
  })

  it('sees through a useState lazy initializer', () => {
    expect(refs('const [v, setV] = useState(() => seed.value)')).toEqual(['seed', 'useState'])
  })

  it('keeps functions nested inside a sync callback deferred', () => {
    expect(refs('const p = useMemo(() => () => later(), [])')).toEqual(['useMemo'])
  })

  it('does NOT see into useEffect/useCallback callbacks — those never run during evaluation', () => {
    expect(refs('useEffect(() => { mark(st) }, [])')).toEqual(['useEffect'])
    expect(refs('const cb = useCallback(() => st.page, [])')).toEqual(['useCallback'])
  })

  it('treats an IIFE body as immediate', () => {
    expect(refs('const v = (function () { return seed.value })()')).toEqual(['seed'])
    expect(refs('const v = (() => seed.value)()')).toEqual(['seed'])
  })
})

describe('collectReferencedIdentifiers — scoping', () => {
  it('does not report names shadowed by function parameters', () => {
    expect(refs('const f = (rows) => rows.length', { includeDeferred: true })).toEqual([])
  })

  it('does not report names shadowed inside a nested block', () => {
    expect(refs('{ const a = 1; use(a) }')).toEqual(['use'])
  })

  it('does not report a catch binding', () => {
    expect(refs('try { run() } catch (err) { log(err) }')).toEqual(['log', 'run'])
  })

  it('does not report for-of loop bindings', () => {
    expect(refs('for (const row of rows) { push(row) }')).toEqual(['push', 'rows'])
  })

  it('shares one scope across switch cases', () => {
    expect(refs('switch (kind) { case 1: const v = 1; break; default: use(v) }')).toEqual([
      'kind',
      'use',
    ])
  })

  it('honours the `only` filter', () => {
    const only = new Set(['b'])
    expect(refs('const a = b + c', { only })).toEqual(['b'])
  })
})
