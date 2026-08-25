import generate from '@babel/generator'
import { parse } from '@babel/parser'
import * as types from '@babel/types'
import { ChunkDefinition, ChunkType, FileType } from '@teleporthq/teleport-types'
import Builder from '../src/builder'

/**
 * The builder is the choke point every AST chunk passes through on its way to
 * source code, which makes it the last line of defence against a plugin that
 * splices statements into a component body at the wrong position. These tests
 * pin the two repairs down AT that choke point, so no future plugin — not just
 * the one that caused the original bug — can ship either defect:
 *
 *   - a hook unshifted ABOVE the state it reads
 *     (`ReferenceError: Cannot access 'ds_0_state' before initialization`), or
 *   - a hook pushed AFTER the `return`, where it silently never runs.
 */

const astChunk = (content: types.Statement): ChunkDefinition => ({
  name: 'jsx-component',
  type: ChunkType.AST,
  fileType: FileType.JS,
  linkAfter: [],
  content,
  meta: {},
})

const componentFromSource = (source: string): types.Statement =>
  parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body[0] as types.Statement

describe('builder statement-order safety net', () => {
  it('repairs a use-before-declaration produced by a misplaced insertion', () => {
    const code = new Builder().link([
      astChunk(
        componentFromSource(`
          const Page = (props) => {
            const params = useMemo(() => ({ page: st.page }), [st])
            const [st, setSt] = useState({ page: 1 })
            return <DataProvider params={params} />
          }
        `)
      ),
    ])

    expect(code.indexOf('const [st')).toBeGreaterThan(-1)
    expect(code.indexOf('const [st')).toBeLessThan(code.indexOf('const params'))
  })

  it('recovers a hook pushed into the unreachable tail after the return', () => {
    const code = new Builder().link([
      astChunk(
        componentFromSource(`
          const Page = (props) => {
            const [st, setSt] = useState(0)
            return <div />
            useEffect(() => { revalidate() }, [])
          }
        `)
      ),
    ])

    expect(code.indexOf('useEffect')).toBeGreaterThan(-1)
    expect(code.indexOf('useEffect')).toBeLessThan(code.indexOf('return'))
  })

  it('emits healthy chunks untouched', () => {
    const source = `
      const Page = (props) => {
        const [st, setSt] = useState(0)
        const params = useMemo(() => ({ page: st }), [st])
        useEffect(() => { revalidate() }, [])
        return <DataProvider params={params} />
      }
    `
    const code = new Builder().link([astChunk(componentFromSource(source))])

    // Printed WITHOUT the net — byte-identical output proves the net did not
    // touch a body that was already valid.
    const expected = generate(componentFromSource(source)).code
    expect(code.trim()).toBe(expected.trim())
  })
})
