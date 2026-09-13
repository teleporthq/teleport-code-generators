import { GeneratedFolder } from '@teleporthq/teleport-types'
import { LocalImports } from '../../src'

const {
  collectProjectFiles,
  findUnresolvedLocalImports,
  findUnresolvedLocalImportsInProject,
  formatUnresolvedLocalImports,
} = LocalImports

const file = (name: string, fileType: string, content = '') => ({ name, fileType, content })

const folder = (
  name: string,
  files: Array<ReturnType<typeof file>> = [],
  subFolders: GeneratedFolder[] = []
): GeneratedFolder => ({ name, files, subFolders } as GeneratedFolder)

describe('collectProjectFiles', () => {
  it('addresses every file relative to the project root, not to the root folder name', () => {
    const project = folder(
      'my-project',
      [file('package', 'json', '{}')],
      [folder('pages', [file('index', 'js', '')], [folder('blog', [file('[slug]', 'js', '')])])]
    )

    expect(
      collectProjectFiles(project)
        .map((entry) => entry.path)
        .sort()
    ).toEqual(['package.json', 'pages/blog/[slug].js', 'pages/index.js'])
  })

  it('skips the content of base64 files', () => {
    const project = folder('my-project', [
      { ...file('logo', 'png', 'iVBORw0KGgo='), contentEncoding: 'base64' as const },
    ])

    expect(collectProjectFiles(project)[0].content).toBe('')
  })
})

describe('findUnresolvedLocalImports', () => {
  it('accepts an import that resolves to a generated file', () => {
    const unresolved = findUnresolvedLocalImports([
      {
        path: 'pages/blog/[slug].js',
        content: `import fetcher from '../../resources/fetch-posts'`,
      },
      { path: 'resources/fetch-posts.js', content: '' },
    ])

    expect(unresolved).toEqual([])
  })

  it('reports the page-folder/root-folder collision that broke `next build`', () => {
    const unresolved = findUnresolvedLocalImports([
      {
        path: 'pages/resources/[id].js',
        content: `import fetcher from '../fetch_content_items_detail'`,
      },
      { path: 'resources/fetch_content_items_detail.js', content: '' },
    ])

    expect(unresolved).toEqual([
      { filePath: 'pages/resources/[id].js', specifier: '../fetch_content_items_detail' },
    ])
  })

  it('resolves extensionless, explicit-extension, folder-index and multi-line imports', () => {
    const unresolved = findUnresolvedLocalImports([
      {
        path: 'pages/index.js',
        content: [
          `import {`,
          `  Repeater,`,
          `} from '../components/navigation'`,
          `import '../pages/style.css'`,
          `import cache from '../utils/tq-cache'`,
          `const runtime = require('../utils/workflows/runtime')`,
          `const lazy = () => import('../components/footer')`,
        ].join('\n'),
      },
      { path: 'components/navigation.js', content: '' },
      { path: 'components/footer.jsx', content: '' },
      { path: 'pages/style.css', content: '' },
      { path: 'utils/tq-cache/index.js', content: '' },
      { path: 'utils/workflows/runtime.js', content: '' },
    ])

    expect(unresolved).toEqual([])
  })

  it('reports an import that climbs above the project root', () => {
    const unresolved = findUnresolvedLocalImports([
      { path: 'pages/index.js', content: `import x from '../../outside/thing'` },
    ])

    expect(unresolved).toEqual([{ filePath: 'pages/index.js', specifier: '../../outside/thing' }])
  })

  it('ignores package imports, aliases and non-JS files', () => {
    const unresolved = findUnresolvedLocalImports([
      {
        path: 'pages/index.js',
        content: [
          `import React from 'react'`,
          `import { useGlobalState } from '@/global-state-context'`,
        ].join('\n'),
      },
      { path: 'pages/style.css', content: `@import './missing.css';` },
    ])

    expect(unresolved).toEqual([])
  })

  it('ignores a bundler suffix on the specifier', () => {
    const unresolved = findUnresolvedLocalImports([
      { path: 'pages/index.js', content: `import icon from '../public/icon.svg?inline'` },
      { path: 'public/icon.svg', content: '' },
    ])

    expect(unresolved).toEqual([])
  })

  it('reports every offending file, sorted, and reports each specifier once', () => {
    const unresolved = findUnresolvedLocalImports([
      { path: 'pages/b.js', content: `import x from './missing'\nimport y from './missing'` },
      { path: 'pages/a.js', content: `import z from './also-missing'` },
    ])

    expect(unresolved).toEqual([
      { filePath: 'pages/a.js', specifier: './also-missing' },
      { filePath: 'pages/b.js', specifier: './missing' },
    ])
  })
})

describe('findUnresolvedLocalImportsInProject', () => {
  it('walks a generated folder', () => {
    const project = folder(
      'my-project',
      [],
      [
        folder(
          'pages',
          [],
          [folder('resources', [file('[id]', 'js', `import r from '../fetch'`)])]
        ),
        folder('resources', [file('fetch', 'js', '')]),
      ]
    )

    expect(findUnresolvedLocalImportsInProject(project)).toEqual([
      { filePath: 'pages/resources/[id].js', specifier: '../fetch' },
    ])
  })
})

describe('formatUnresolvedLocalImports', () => {
  it('is empty when there is nothing to report', () => {
    expect(formatUnresolvedLocalImports([])).toBe('')
  })

  it('names every file and specifier', () => {
    const report = formatUnresolvedLocalImports([
      { filePath: 'pages/resources/[id].js', specifier: '../fetch_content_items_detail' },
    ])

    expect(report).toContain('pages/resources/[id].js')
    expect(report).toContain('../fetch_content_items_detail')
    expect(report).toContain('Module not found')
  })
})
