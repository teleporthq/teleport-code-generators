import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { reconcileGeneratedTree } from '../src/generate-project'

const write = (root: string, rel: string, content: string) => {
  const path = join(root, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

describe('reconcileGeneratedTree (re-sync-safe replacement for clean-then-rewrite)', () => {
  let staging: string
  let project: string

  beforeEach(() => {
    staging = mkdtempSync(join(tmpdir(), 'reconcile-staging-'))
    project = mkdtempSync(join(tmpdir(), 'reconcile-project-'))
  })

  afterEach(() => {
    rmSync(staging, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })

  it('copies new files, overwrites changed ones, and deletes orphans (the stale-orphan guarantee)', () => {
    write(project, 'pages/index.js', 'old index')
    write(project, 'pages/removed.js', 'about to be orphaned')
    write(staging, 'pages/index.js', 'new index')
    write(staging, 'pages/added.js', 'brand new')

    reconcileGeneratedTree(staging, project)

    expect(readFileSync(join(project, 'pages/index.js'), 'utf8')).toBe('new index')
    expect(readFileSync(join(project, 'pages/added.js'), 'utf8')).toBe('brand new')
    expect(existsSync(join(project, 'pages/removed.js'))).toBe(false)
  })

  it('leaves byte-identical files untouched so a live watcher sees no event for them', () => {
    write(project, 'components/card.js', 'same content')
    write(staging, 'components/card.js', 'same content')
    const before = statSync(join(project, 'components/card.js')).mtimeMs

    reconcileGeneratedTree(staging, project)

    expect(statSync(join(project, 'components/card.js')).mtimeMs).toBe(before)
  })

  it('never deletes a directory that still exists in the new output (webpack keeps its watch)', () => {
    write(project, 'pages/index.js', 'old')
    write(staging, 'pages/index.js', 'new')
    const inodeBefore = statSync(join(project, 'pages')).ino

    reconcileGeneratedTree(staging, project)

    expect(statSync(join(project, 'pages')).ino).toBe(inodeBefore)
  })

  it('preserves install and user-owned entries at the project root, exactly like the clean', () => {
    write(project, 'node_modules/somepkg/index.js', 'installed')
    write(project, '.next/cache/entry', 'build cache')
    write(project, 'CLAUDE.md', 'agent briefing')
    write(staging, 'pages/index.js', 'generated')

    reconcileGeneratedTree(staging, project)

    expect(readFileSync(join(project, 'node_modules/somepkg/index.js'), 'utf8')).toBe('installed')
    expect(readFileSync(join(project, '.next/cache/entry'), 'utf8')).toBe('build cache')
    expect(readFileSync(join(project, 'CLAUDE.md'), 'utf8')).toBe('agent briefing')
  })

  it('handles a file replaced by a directory and vice versa', () => {
    write(project, 'utils', 'utils used to be a FILE')
    write(staging, 'utils/helpers.js', 'now a directory')
    write(project, 'config/settings.js', 'config used to be a DIRECTORY')
    write(staging, 'config', 'now a file')

    reconcileGeneratedTree(staging, project)

    expect(readFileSync(join(project, 'utils/helpers.js'), 'utf8')).toBe('now a directory')
    expect(readFileSync(join(project, 'config'), 'utf8')).toBe('now a file')
  })
})
