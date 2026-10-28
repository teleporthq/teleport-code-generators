import { posix } from 'path'
import type { GeneratedFolder } from '@teleporthq/teleport-types'
import NextTemplate from '../src/project-template'
import { createNextProjectGenerator } from '../src'
import {
  buildDataExposureUidl,
  DATA_SOURCE_ID,
  MEMBER_TABLE,
} from './_helpers/data-exposure-fixture'

/**
 * The table-access guard every data route inlines compares the app secret
 * with the shared security runtime's `safeEqual`, required (inside `try`) from
 * the project root the route sits below — and reads the session through the
 * revocation-aware reader, required from the same root. A wrong depth is no
 * build error (webpack only warns on an optional require): every server
 * segment's data call would be treated as a browser's, and the store's server
 * reads and writes would stop. So every route family is generated, and every
 * runtime and revocation require in every emitted file must name the project's
 * file from the folder the generator placed that file in.
 */

const RUNTIME = 'utils/security-runtime'
const REVOCATION = 'utils/auth/session-revocation'
const PROJECT_REQUIRE =
  /require\(\s*['"]([^'"]*utils\/(?:security-runtime|auth\/session-revocation))['"]\s*\)/g
const TABLE_ACCESS_GUARD = 'function __taSafeEqual('

/** The data exposure store, with a workflow data step, a page state and a global state read per visitor. */
const everyRouteFamily = () => {
  const uidl = buildDataExposureUidl() as any
  uidl.workflows = {
    workflows: {
      reads: {
        id: 'reads',
        name: 'Reads',
        trigger: { type: 'event-element-clicked', nodeId: 'el', config: {} },
        nodes: [
          {
            id: 'n1',
            type: 'data-select',
            config: { dataSourceId: DATA_SOURCE_ID, tableName: 'team_members' },
          },
        ],
        edges: [],
      },
    },
    customNodes: {},
  }
  uidl.globalStateDefinitions = {
    favourites: {
      name: 'favourites',
      type: 'array',
      defaultValue: [],
      dataSourceBinding: { dataSourceId: DATA_SOURCE_ID, refPath: ['team_members'] },
      query: 'SELECT * FROM team_members',
    },
  }
  // A page state read per signed-in visitor: its own route under pages/api/page-state.
  uidl.root.stateDefinitions.route.values.push({
    value: 'notes',
    pageId: 'TQ_notes',
    seo: { title: 'notes' },
    pageOptions: {
      navLink: '/notes',
      propDefinitions: {},
      stateDefinitions: {
        notes: {
          type: 'array',
          defaultValue: [],
          dataSourceBinding: { dataSourceId: DATA_SOURCE_ID, refPath: [MEMBER_TABLE] },
          query: `SELECT id, name FROM ${MEMBER_TABLE} WHERE user_id = '{{Current User.id}}'`,
        },
      },
    },
  })
  uidl.root.node.content.children.push({
    type: 'conditional',
    content: {
      reference: { type: 'dynamic', content: { referenceType: 'state', id: 'route' } },
      value: 'notes',
      node: { type: 'element', content: { elementType: 'container', children: [] } },
    },
  })
  return uidl
}

/** Every generated file, by its path from the project root. */
const filesOf = (folder: GeneratedFolder, prefix: string[] = []): Map<string, string> => {
  const out = new Map<string, string>()
  for (const file of folder.files || []) {
    if (typeof file.content === 'string') {
      const name = file.fileType ? `${file.name}.${file.fileType}` : file.name
      out.set(posix.join(...prefix, name), file.content)
    }
  }
  for (const sub of folder.subFolders || []) {
    for (const [path, content] of filesOf(sub, [...prefix, sub.name])) {
      out.set(path, content)
    }
  }
  return out
}

describe('every emitted require of the security runtime names it from its own folder', () => {
  let files: Map<string, string>
  beforeAll(async () => {
    const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder
    const project = await createNextProjectGenerator().generateProject(everyRouteFamily(), template)
    files = filesOf(project)
  }, 120000)

  it('resolves to the project files, from every file that requires them', () => {
    expect(files.has(`${RUNTIME}.js`)).toBe(true)
    expect(files.has(`${REVOCATION}.js`)).toBe(true)
    let checked = 0
    for (const [file, code] of files) {
      for (const match of Array.from(code.matchAll(PROJECT_REQUIRE))) {
        const target = match[1].endsWith('security-runtime') ? RUNTIME : REVOCATION
        expect([file, posix.join(posix.dirname(file), match[1])]).toEqual([file, target])
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('covers every table-access route family, each requiring the runtime and the revocation check', () => {
    const guarded = Array.from(files.entries()).filter(([, code]) =>
      code.includes(TABLE_ACCESS_GUARD)
    )
    for (const family of [
      /^pages\/api\/data\//,
      /^pages\/api\/page-state\//,
      /^pages\/api\/global-state\//,
      /^utils\/data-sources\//,
      /^pages\/api\/[^/]+\.js$/,
    ]) {
      const members = guarded.filter(([file]) => family.test(file))
      expect([family.source, members.length > 0]).toEqual([family.source, true])
      for (const [file, code] of members) {
        const required = Array.from(code.matchAll(PROJECT_REQUIRE), (match) =>
          posix.join(posix.dirname(file), match[1])
        )
        expect([file, required.includes(RUNTIME), required.includes(REVOCATION)]).toEqual([
          file,
          true,
          true,
        ])
      }
    }
  })
})
