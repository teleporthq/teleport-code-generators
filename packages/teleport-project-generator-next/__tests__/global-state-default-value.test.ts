import {
  ProjectUIDL,
  UIDLGlobalStateDefinition,
  ProjectPluginStructure,
} from '@teleporthq/teleport-types'
import { NextGlobalStateProjectPlugin } from '../src/global-state/project-plugin'

// Regression guard for "global state initial value rendered nothing because
// the GUI saved a non-array default for an array-typed state".
//
// User report: a workflow populated `countriesWithDescriptions` (declared
// type "array") via state-update-global-state, but the page Repeater never
// showed the items. Root cause: the GUI had stamped a placeholder default
// of `{"0":{"name":"Ion","description":"pasca"}}` (a single-key OBJECT)
// onto the array-typed state. The Repeater bails on `!Array.isArray(items)`,
// so the page rendered nothing on first paint. Even if the workflow setter
// later replaced the value with the real array, any consumer that expected
// `array.map`/`array.length` semantics on first render would error or
// silently skip.
//
// The generator now reconciles the declared type with the supplied default
// before emitting useState(...). This test pins that behaviour at the
// project-plugin level so a future change can't quietly drop the
// normalisation.

const buildUIDL = (
  defaultValue: UIDLGlobalStateDefinition['defaultValue'],
  type: UIDLGlobalStateDefinition['type']
): ProjectUIDL => ({
  name: 'fixture',
  globals: {
    settings: { language: 'en', title: 'fixture' },
    meta: [],
    assets: [],
    manifest: { icons: [] },
  } as any,
  root: {
    name: 'App',
    node: { type: 'element', content: { elementType: 'div' } },
    stateDefinitions: { route: { type: 'string', defaultValue: '/' } },
  } as any,
  globalStateDefinitions: {
    fixtureState: {
      id: 'fixture-id',
      type,
      defaultValue,
      name: 'fixtureState',
    },
  },
})

const runPlugin = async (uidl: ProjectUIDL): Promise<string | undefined> => {
  const plugin = new NextGlobalStateProjectPlugin()
  // The plugin populates structure.files (a Map keyed by logical name) with
  // entries shaped as { path, files: [{ name, fileType, content }] }. We type
  // it loosely here so we can assert against the emitted content string.
  const files = new Map<string, any>()
  const structure: ProjectPluginStructure = {
    uidl,
    files,
    dependencies: {},
    devDependencies: {},
    template: { name: '', files: [], subFolders: [] },
    rootFolder: { name: '', files: [], subFolders: [] },
    strategy: {} as any,
  }
  const result = await plugin.runAfter(structure)
  const entry = result.files.get('global-state-context')
  return entry?.files?.[0]?.content
}

describe('NextGlobalStateProjectPlugin — useState initial value normalization', () => {
  it('coerces a non-array default to [] when the state type is "array"', async () => {
    // The exact malformed shape the GUI produced for the user's bug.
    const uidl = buildUIDL({ '0': { name: 'Ion', description: 'pasca' } }, 'array')
    const content = await runPlugin(uidl)
    expect(content).toBeDefined()
    expect(content).toContain('useState([])')
    expect(content).not.toContain('"Ion"')
    expect(content).not.toContain('"pasca"')
  })

  it('preserves a valid array default verbatim', async () => {
    const uidl = buildUIDL([{ id: 'a' }, { id: 'b' }], 'array')
    const content = await runPlugin(uidl)
    expect(content).toContain('useState([{"id":"a"},{"id":"b"}])')
  })

  it('coerces a non-object default to {} when the state type is "object"', async () => {
    const uidl = buildUIDL([1, 2, 3], 'object')
    const content = await runPlugin(uidl)
    expect(content).toContain('useState({})')
    expect(content).not.toMatch(/useState\(\[1,2,3\]\)/)
  })

  it('coerces a non-string default to "" when the state type is "string"', async () => {
    // The decoded UIDL widens defaultValue to several primitives — pretend
    // a misconfigured default sneaks in as an array.
    const uidl = buildUIDL([] as unknown as string, 'string')
    const content = await runPlugin(uidl)
    expect(content).toContain('useState("")')
  })

  it('parses a numeric string default into a number when the state type is "number"', async () => {
    const uidl = buildUIDL('42' as unknown as number, 'number')
    const content = await runPlugin(uidl)
    expect(content).toContain('useState(42)')
  })

  it('falls back to 0 for a non-numeric default when the state type is "number"', async () => {
    const uidl = buildUIDL('not-a-number' as unknown as number, 'number')
    const content = await runPlugin(uidl)
    expect(content).toContain('useState(0)')
  })

  it('coerces a non-boolean default to false when the state type is "boolean"', async () => {
    const uidl = buildUIDL('false', 'boolean')
    const content = await runPlugin(uidl)
    // "false" string coerces to boolean false (not the truthy default).
    expect(content).toContain('useState(false)')
  })

  it('preserves a true boolean default', async () => {
    const uidl = buildUIDL(true, 'boolean')
    const content = await runPlugin(uidl)
    expect(content).toContain('useState(true)')
  })
})
