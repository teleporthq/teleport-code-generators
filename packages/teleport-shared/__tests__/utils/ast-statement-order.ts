import generate from '@babel/generator'
import { parse } from '@babel/parser'
import * as types from '@babel/types'
import { ASTStatementOrder } from '../../src'

const {
  findDependencySafeIndex,
  insertStatementsAfterDependencies,
  insertStatementsBeforeReturn,
  liftUnreachableTail,
  normalizeStatementOrder,
  repairTemporalDeadZone,
} = ASTStatementOrder

const parseFile = (code: string): types.File =>
  parse(code, { sourceType: 'module', plugins: ['jsx'] })

/** The block statement of the first arrow-function component in `code`. */
const componentBody = (file: types.File): types.BlockStatement => {
  const declaration = file.program.body.find(
    (statement) => statement.type === 'VariableDeclaration'
  ) as types.VariableDeclaration
  const arrow = declaration.declarations[0].init as types.ArrowFunctionExpression
  return arrow.body as types.BlockStatement
}

const statementsOf = (code: string): types.Statement[] =>
  parseFile(code).program.body as types.Statement[]

const print = (node: types.Node): string => generate(node).code

/**
 * The exact shape that crashed `/blog` in production: the hoisted cache params
 * memo was unshifted ABOVE the `useState` it reads, and the hydration effect
 * was pushed AFTER the `return`.
 */
const BROKEN_BLOG_PAGE = `
const BlogPostsList = (props) => {
  const ds_0_params = useMemo(() => ({ page: ds_0_state.page, query: ds_0_state.debouncedQuery }), [ds_0_state])
  const ds_0_cached = useMemo(() => tqCacheGet('scope', tqCacheKey(ds_0_params), { sticky: true }), [ds_0_params])
  const [ds_0_state, setDs_0_state] = useState({ page: 1, debouncedQuery: '' })
  return <DataProvider params={ds_0_params} initialData={ds_0_cached} />
  useEffect(() => { tqMarkHydrated() }, [])
}
`

describe('findDependencySafeIndex / insertStatementsAfterDependencies', () => {
  it('places dependent statements one past the last declaration they read', () => {
    const body = componentBody(
      parseFile(`
        const C = (props) => {
          const [a, setA] = useState(0)
          const [b, setB] = useState(0)
          useEffect(() => { setA(1) }, [])
          return <div />
        }
      `)
    )
    const inserted = statementsOf('const memo = useMemo(() => a + b, [a, b])')

    expect(findDependencySafeIndex(body.body, inserted)).toBe(2)

    insertStatementsAfterDependencies(body, inserted)
    expect(print(body.body[2])).toContain('const memo')
  })

  it('counts deferred reads too, so an inserted callback can never race its declaration', () => {
    const body = componentBody(
      parseFile(`
        const C = (props) => {
          const [a, setA] = useState(0)
          return <div />
        }
      `)
    )
    const inserted = statementsOf('const onClick = () => setA(a + 1)')

    expect(findDependencySafeIndex(body.body, inserted)).toBe(1)
  })

  it('places independent statements at the top and reports the index', () => {
    const body = componentBody(
      parseFile(`
        const C = (props) => {
          const [a, setA] = useState(0)
          return <div />
        }
      `)
    )
    expect(
      insertStatementsAfterDependencies(body, statementsOf('const t = useTranslations()'))
    ).toBe(0)
    expect(print(body.body[0])).toContain('useTranslations')
  })

  it('ignores names the inserted group declares for itself', () => {
    const body = componentBody(
      parseFile(`
        const C = (props) => {
          const [st, setSt] = useState(0)
          return <div />
        }
      `)
    )
    // Second statement reads the first one's binding — an intra-group
    // dependency, not a dependency on the body.
    const group = statementsOf(`
      const params = useMemo(() => ({ page: st }), [st])
      const cached = useMemo(() => peek(params), [params])
    `)

    insertStatementsAfterDependencies(body, group)
    expect(print(body.body[1])).toContain('const params')
    expect(print(body.body[2])).toContain('const cached')
  })
})

describe('insertStatementsBeforeReturn', () => {
  it('lands immediately before the return statement', () => {
    const body = componentBody(
      parseFile(`
        const C = (props) => {
          const [a, setA] = useState(0)
          return <div />
        }
      `)
    )
    insertStatementsBeforeReturn(body, statementsOf('useEffect(() => { mark() }, [])'))

    expect(print(body.body[1])).toContain('useEffect')
    expect(body.body[2].type).toBe('ReturnStatement')
  })

  it('appends when the body has no return', () => {
    const body = componentBody(parseFile(`const C = (props) => { const a = 1 }`))
    insertStatementsBeforeReturn(body, statementsOf('mark()'))
    expect(print(body.body[1])).toContain('mark()')
  })
})

describe('liftUnreachableTail', () => {
  it('moves expression statements and declarations from behind the return', () => {
    const body = componentBody(
      parseFile(`
        const C = (props) => {
          return <div />
          useEffect(() => { mark() }, [])
          const late = useMemo(() => 1, [])
        }
      `)
    )

    expect(liftUnreachableTail(body)).toBe(true)
    expect(print(body.body[0])).toContain('useEffect')
    expect(print(body.body[1])).toContain('const late')
    expect(body.body[2].type).toBe('ReturnStatement')
    expect(body.body).toHaveLength(3)
  })

  it('leaves hoisted declarations behind the return alone — they are observable where they are', () => {
    const body = componentBody(
      parseFile(`
        const C = (props) => {
          return helper()
          function helper() { return 1 }
          var flag = true
        }
      `)
    )

    expect(liftUnreachableTail(body)).toBe(false)
    expect(body.body[0].type).toBe('ReturnStatement')
  })

  it('reports false when the return is last', () => {
    const body = componentBody(parseFile(`const C = (props) => { return <div /> }`))
    expect(liftUnreachableTail(body)).toBe(false)
  })
})

describe('repairTemporalDeadZone', () => {
  it('reorders a read-before-declaration into a valid, dependency-respecting order', () => {
    const file = parseFile(BROKEN_BLOG_PAGE)
    const body = componentBody(file)

    expect(repairTemporalDeadZone(body)).toBe(true)

    const code = print(body)
    expect(code.indexOf('const [ds_0_state')).toBeLessThan(code.indexOf('const ds_0_params'))
    expect(code.indexOf('const ds_0_params')).toBeLessThan(code.indexOf('const ds_0_cached'))
    // Executable again: evaluating the reordered body must not throw.
    expect(() =>
      new Function(
        'useMemo',
        'useState',
        'tqCacheGet',
        'tqCacheKey',
        print(types.blockStatement(body.body.filter((s) => s.type === 'VariableDeclaration')))
      )(
        (cb: () => unknown) => cb(),
        (v: unknown) => [v, (): void => undefined],
        (): void => undefined,
        () => 'key'
      )
    ).not.toThrow()
  })

  it('leaves an already-valid body byte-identical', () => {
    const body = componentBody(
      parseFile(`
        const C = (props) => {
          const [st, setSt] = useState(0)
          const params = useMemo(() => ({ page: st }), [st])
          return <div />
        }
      `)
    )
    const before = print(body)

    expect(repairTemporalDeadZone(body)).toBe(false)
    expect(print(body)).toBe(before)
  })

  it('does not treat deferred callback reads as violations', () => {
    const body = componentBody(
      parseFile(`
        const C = (props) => {
          const onClick = () => helper()
          const helper = () => 1
          return <div />
        }
      `)
    )
    const before = print(body)

    expect(repairTemporalDeadZone(body)).toBe(false)
    expect(print(body)).toBe(before)
  })

  it('respects shadowing — an inner binding is not a read of the outer one', () => {
    const body = componentBody(
      parseFile(`
        const C = (props) => {
          const compute = (rows) => rows.length
          if (props.flag) { const rows = [] ; compute(rows) }
          const rows = useRows()
          return <div />
        }
      `)
    )
    const before = print(body)

    expect(repairTemporalDeadZone(body)).toBe(false)
    expect(print(body)).toBe(before)
  })

  it('leaves a genuine dependency cycle untouched instead of half-rewriting it', () => {
    const body = componentBody(
      parseFile(`
        const C = (props) => {
          const a = b + 1
          const b = a + 1
          return <div />
        }
      `)
    )
    const before = print(body)

    expect(repairTemporalDeadZone(body)).toBe(false)
    expect(print(body)).toBe(before)
  })

  it('keeps independent statements in their original relative order', () => {
    const body = componentBody(
      parseFile(`
        const C = (props) => {
          const first = useMemo(() => st.page, [st])
          const second = useRef(0)
          const third = useRef(1)
          const [st, setSt] = useState({ page: 1 })
          return <div />
        }
      `)
    )

    expect(repairTemporalDeadZone(body)).toBe(true)

    const code = print(body)
    expect(code.indexOf('second')).toBeLessThan(code.indexOf('third'))
    expect(code.indexOf('third')).toBeLessThan(code.indexOf('const [st'))
    expect(code.indexOf('const [st')).toBeLessThan(code.indexOf('first'))
  })
})

describe('normalizeStatementOrder', () => {
  it('repairs both defects of the /blog page in one pass', () => {
    const file = parseFile(BROKEN_BLOG_PAGE)

    expect(normalizeStatementOrder(file)).toBeGreaterThan(0)

    const body = componentBody(file)
    const code = print(body)
    expect(code.indexOf('const [ds_0_state')).toBeLessThan(code.indexOf('const ds_0_params'))
    expect(code.indexOf('tqMarkHydrated')).toBeLessThan(code.indexOf('return'))
    expect(body.body[body.body.length - 1].type).toBe('ReturnStatement')
  })

  it('reaches nested function bodies', () => {
    const file = parseFile(`
      const C = (props) => {
        const fetchData = useCallback((params) => {
          const rows = transform(raw)
          const raw = load(params)
          return rows
        }, [])
        return <div />
      }
    `)

    expect(normalizeStatementOrder(file)).toBe(1)
    const code = print(file)
    expect(code.indexOf('const raw')).toBeLessThan(code.indexOf('const rows'))
  })

  it('returns 0 and changes nothing on healthy code', () => {
    const file = parseFile(`
      const C = (props) => {
        const [st, setSt] = useState(0)
        const params = useMemo(() => ({ page: st }), [st])
        useEffect(() => { revalidate() }, [])
        return <DataProvider params={params} />
      }
      export default C
    `)
    const before = print(file)

    expect(normalizeStatementOrder(file)).toBe(0)
    expect(print(file)).toBe(before)
  })

  it("never reorders module scope — chunk order is the linker's job", () => {
    const file = parseFile(`
      const uses = helper()
      const helper = () => 1
    `)
    const before = print(file)

    expect(normalizeStatementOrder(file)).toBe(0)
    expect(print(file)).toBe(before)
  })
})
