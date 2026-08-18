import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { join, resolve } from 'path'
import { performance } from 'perf_hooks'
import {
  GeneratedFile,
  PackerOptions,
  ProjectPlugin,
  ProjectType,
  ProjectUIDL,
  PublisherType,
} from '@teleporthq/teleport-types'
import { packProject } from '@teleporthq/teleport-code-generator'

/**
 * Packing a UIDL into a project on disk, parameterised.
 *
 * Backs `yarn generate` — the entry point for the GUI's Teleport & Run button,
 * the artifact prober and CI, none of which can use `standalone.ts`: that script
 * imports its UIDL at module scope from a git-tracked fixture and hard-codes the
 * output slug, so it can only ever produce one project from one file. It stays
 * exactly as it is; it runs on every file save while the generators are being
 * developed, and that loop is not this module's business.
 *
 * The `.env` and clean-up helpers below are deliberate duplicates of the ones in
 * `standalone.ts`. Keep the two `PRESERVE_ON_CLEAN` sets identical — they decide
 * what a regeneration is allowed to delete from a directory the developer may
 * have put real work into.
 */

// Files/dirs that are NOT produced by the generator and must survive a clean:
// install artifacts and user-owned config. Everything else in the project dir
// is regenerated every run.
// `.vscode`, `.claude` and `CLAUDE.md` are editor/agent scaffolding dropped into
// the generated project by tooling (or by hand) — the generator never emits
// them, so wiping them would only cost the developer their setup.
export const PRESERVE_ON_CLEAN = new Set([
  'node_modules',
  '.env',
  '.env.local',
  '.git',
  'package-lock.json',
  'yarn.lock',
  '.next',
  '.vscode',
  '.claude',
  'CLAUDE.md',
])

// Parse a KEY=value .env file into a plain object. Lines starting with `#`
// and empty lines are skipped. Values are taken verbatim (no quote
// unwrapping) because that's how `createEnvFiles` also writes them.
export const parseDotEnv = (content: string): Record<string, string> => {
  const out: Record<string, string> = {}
  content.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      return
    }
    const eq = line.indexOf('=')
    if (eq < 0) {
      return
    }
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    if (key) {
      out[key] = value
    }
  })
  return out
}

// Preserve the buyer-editable subset of an existing `.env` across regeneration.
// The generator strips `teleporthq.secrets.*` placeholders to empty strings via
// `resolveAuthEnvValue`, so without this hook every run wipes out values the
// user (or the GUI's secret resolver) set — Stripe / PayPal test keys, the DB
// connection string, and so on. Injecting the on-disk values into
// `uidl.globals.env` BEFORE packing makes them survive into the regenerated file.
export const preserveExistingEnv = (uidl: ProjectUIDL, envPath: string): number => {
  if (!existsSync(envPath)) {
    return 0
  }
  let raw = ''
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    return 0
  }
  const existing = parseDotEnv(raw)
  // A well-formed ProjectUIDL always has `globals`, but the input fixture may
  // be a page/component UIDL (no `globals`) or a partially-built project. Guard
  // rather than crash — env preservation is a best-effort convenience, not a
  // hard requirement of the run.
  if (!uidl.globals) {
    return 0
  }
  if (!uidl.globals.env) {
    uidl.globals.env = {}
  }
  const env = uidl.globals.env as Record<string, string>
  // Copy over every existing key (even ones the generator did not emit this
  // pass) so user-added entries such as TELEPORT_PROJECT_TOKEN stay in the
  // regenerated file. Values that are explicitly empty in the file are kept
  // empty — matching what the user saw on disk.
  Object.keys(existing).forEach((key) => {
    env[key] = existing[key]
  })
  return Object.keys(existing).length
}

// Remove previously-generated files before a fresh run so STALE ORPHANS can't
// linger. The disk publisher only writes the files produced by THIS generation;
// it never deletes files an earlier generation emitted. So when the UIDL changes
// — e.g. authentication is turned off, a workflow/widget is removed — the old
// `middleware.js` / `utils/auth/*` (which import `next-auth`), dead workflow API
// routes, or an orphan `components/tq-*.js` are left behind, while the
// regenerated `package.json` no longer lists their npm deps. `next build` then
// fails with "Module not found: Can't resolve 'next-auth/jwt'" (or framer-motion,
// etc). Wiping the generated tree — preserving only install + user-owned files —
// guarantees the output always reflects exactly the current UIDL.
export const cleanGeneratedFiles = (projectDir: string): void => {
  if (!existsSync(projectDir)) {
    return
  }
  for (const entry of readdirSync(projectDir)) {
    if (PRESERVE_ON_CLEAN.has(entry)) {
      continue
    }
    rmSync(join(projectDir, entry), { recursive: true, force: true })
  }
}

/**
 * Bring `projectDir` to exactly the contents of `generatedDir` with MINIMAL
 * churn — the re-sync-safe replacement for clean-then-rewrite. The generated
 * project's `next dev` may be WATCHING projectDir: deleting whole directories
 * and streaming them back (the old clean) fed the watcher seconds of
 * half-written tree — transient compile errors that sometimes wedged the dev
 * server, and (worse) webpack drops its watch on a deleted-then-recreated
 * directory, after which hot reload silently stops. Reconciling instead:
 * - overwrites a file only when its BYTES changed (untouched files produce no
 *   watch events at all — a typical re-sync touches a handful of files);
 * - deletes orphans file-by-file, so the stale-orphan guarantee that motivated
 *   the clean still holds;
 * - never deletes a directory that still exists in the new output, so watches
 *   stay alive.
 * PRESERVE_ON_CLEAN is honored for deletions at the project root, exactly like
 * the clean.
 */
export const reconcileGeneratedTree = (generatedDir: string, projectDir: string): void => {
  const syncDir = (from: string, to: string, depth: number): void => {
    mkdirSync(to, { recursive: true })
    const fromEntries = readdirSync(from, { withFileTypes: true })
    const fromNames = new Set(fromEntries.map((entry) => entry.name))

    for (const entry of readdirSync(to, { withFileTypes: true })) {
      if (depth === 0 && PRESERVE_ON_CLEAN.has(entry.name)) {
        continue
      }
      if (!fromNames.has(entry.name)) {
        rmSync(join(to, entry.name), { recursive: true, force: true })
      }
    }

    for (const entry of fromEntries) {
      const src = join(from, entry.name)
      const dst = join(to, entry.name)
      const dstExists = existsSync(dst)
      if (entry.isDirectory()) {
        if (dstExists && !statSync(dst).isDirectory()) {
          rmSync(dst, { force: true })
        }
        syncDir(src, dst, depth + 1)
        continue
      }
      if (dstExists && statSync(dst).isDirectory()) {
        rmSync(dst, { recursive: true, force: true })
      }
      const next = readFileSync(src)
      if (!existsSync(dst) || !readFileSync(dst).equals(next)) {
        writeFileSync(dst, next)
      }
    }
  }

  syncDir(generatedDir, projectDir, 0)
}

/**
 * Size of the GENERATED tree only — `node_modules` and `.next` are install and
 * build artifacts that would swamp the signal. Reported so a regression in
 * output size is visible without diffing two trees.
 */
const measureGeneratedTree = (dir: string): { fileCount: number; byteCount: number } => {
  let fileCount = 0
  let byteCount = 0

  const walk = (current: string, depth: number) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (depth === 0 && PRESERVE_ON_CLEAN.has(entry.name)) {
        continue
      }
      const entryPath = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(entryPath, depth + 1)
      } else if (entry.isFile()) {
        fileCount += 1
        byteCount += statSync(entryPath).size
      }
    }
  }

  if (existsSync(dir)) {
    walk(dir, 0)
  }
  return { fileCount, byteCount }
}

/**
 * The generators talk to the developer through `console` — unbound expressions
 * that had to be replaced with `""`, prop/state definitions declared but never
 * used, missing mappings. Those lines are the earliest warning that a UIDL and
 * the emitted code disagree, and until now they scrolled past in a terminal and
 * were gone. Capturing them makes them a field on the result, so the artifact
 * report can carry them and a detector can act on them.
 */
const captureConsole = async <T>(sink: string[], work: () => Promise<T>): Promise<T> => {
  /* tslint:disable:no-console — this helper's whole job is to hold the
     generators' console output; the repo lints with tslint, so an eslint
     pragma silenced nothing. */
  const original = { log: console.log, info: console.info, warn: console.warn }
  const record = (...parts: unknown[]) => {
    sink.push(parts.map((part) => (typeof part === 'string' ? part : String(part))).join(' '))
  }
  console.log = record
  console.info = record
  console.warn = record
  try {
    return await work()
  } finally {
    console.log = original.log
    console.info = original.info
    console.warn = original.warn
  }
  /* tslint:enable:no-console */
}

export interface GenerateProjectParams {
  uidl: ProjectUIDL
  /** Output root that will contain `<outRoot>/<slug>`. */
  outRoot: string
  slug: string
  projectType: ProjectType
  /** `.env` whose values are folded back into the UIDL before packing. */
  envPath?: string
  plugins?: ProjectPlugin[]
  assets?: GeneratedFile[]
  packerOverrides?: Partial<PackerOptions>
}

export interface GenerateProjectResult {
  ok: boolean
  slug: string
  projectType: string
  projectDir: string
  fileCount: number
  byteCount: number
  preservedEnvKeys: number
  /** Everything the generators printed while packing (see `captureConsole`). */
  warnings: string[]
  /**
   * Packages whose `src/` is newer than the `dist/` this run actually used, so a
   * reader knows whether the output reflects the checked-out code at all.
   */
  staleGenerators?: Array<{ name: string; sourceModified: string; builtModified: string | null }>
  timings: { cleanMs: number; packMs: number; totalMs: number }
  error?: { message: string; stack?: string }
}

export const generateProject = async (
  params: GenerateProjectParams
): Promise<GenerateProjectResult> => {
  const {
    uidl,
    slug,
    projectType,
    envPath,
    plugins = [],
    assets = [],
    packerOverrides = {},
  } = params
  const outRoot = resolve(params.outRoot)
  const projectDir = join(outRoot, slug)

  const startedAt = performance.now()
  const warnings: string[] = []
  let cleanMs = 0
  let packMs = 0
  let preservedEnvKeys = 0

  const failure = (error: unknown): GenerateProjectResult => ({
    ok: false,
    slug,
    projectType,
    projectDir,
    fileCount: 0,
    byteCount: 0,
    preservedEnvKeys,
    warnings,
    timings: { cleanMs, packMs, totalMs: performance.now() - startedAt },
    error: {
      message: (error as Error)?.message ?? String(error),
      stack: (error as Error)?.stack,
    },
  })

  try {
    if (!existsSync(outRoot)) {
      mkdirSync(outRoot, { recursive: true })
    }

    // Read the existing `.env` BEFORE generating: the values are folded into
    // the UIDL so the REGENERATED .env carries them forward.
    preservedEnvKeys = preserveExistingEnv(uidl, envPath ?? join(projectDir, '.env'))

    // Generate into a STAGING directory, then reconcile into the (possibly
    // live-watched) project directory — see reconcileGeneratedTree. The old
    // clean-then-pack-in-place fed a running `next dev` seconds of half-written
    // tree on every re-sync.
    const stagingRoot = join(outRoot, '.resync-staging')
    rmSync(stagingRoot, { recursive: true, force: true })

    const packStartedAt = performance.now()
    await captureConsole(warnings, () =>
      packProject(uidl, {
        publisher: PublisherType.DISK,
        assets,
        ...packerOverrides,
        projectType,
        plugins,
        publishOptions: {
          ...(packerOverrides.publishOptions ?? {}),
          outputPath: stagingRoot,
          projectSlug: slug,
        },
      })
    )
    packMs = performance.now() - packStartedAt

    const reconcileStartedAt = performance.now()
    reconcileGeneratedTree(join(stagingRoot, slug), projectDir)
    rmSync(stagingRoot, { recursive: true, force: true })
    cleanMs = performance.now() - reconcileStartedAt
  } catch (error) {
    return failure(error)
  }

  const { fileCount, byteCount } = measureGeneratedTree(projectDir)

  return {
    ok: true,
    slug,
    projectType,
    projectDir,
    fileCount,
    byteCount,
    preservedEnvKeys,
    warnings,
    timings: { cleanMs, packMs, totalMs: performance.now() - startedAt },
  }
}
