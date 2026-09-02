// @ts-nocheck
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  accessSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
} from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { packProject } from '@teleporthq/teleport-code-generator'
import {
  ProjectUIDL,
  PackerOptions,
  ProjectType,
  PublisherType,
  ProjectPlugin,
} from '@teleporthq/teleport-types'
import { performance } from 'perf_hooks'
import { LocalImports } from '@teleporthq/teleport-shared'
import { ProjectPluginCSSModules } from '@teleporthq/teleport-project-plugin-css-modules'
import { ProjectPluginReactJSS } from '@teleporthq/teleport-project-plugin-react-jss'
import { ProjectPluginStyledComponents } from '@teleporthq/teleport-project-plugin-styled-components'
import { ProjectPluginParseEmbed } from '@teleporthq/teleport-project-plugin-parse-embed'
import projectJSON from '../../../examples/uidl-samples/project.json'
import contentfulUIDL from '../../../examples/uidl-samples/contentful.json'
import strapiUIDL from '../../../examples/uidl-samples/strapi.json'
import wordpressUIDL from '../../../examples/uidl-samples/wordpress.json'
import caisyUIDL from '../../../examples/uidl-samples/caisy.json'
import flotiqUIDL from '../../../examples/uidl-samples/flotiq.json'

const projectUIDL = projectJSON as unknown as ProjectUIDL
const assetFile = readFileSync(join(__dirname, 'asset.png'))
const base64File = Buffer.from(assetFile).toString('base64')
const packerOptions: PackerOptions = {
  publisher: PublisherType.DISK,
  projectType: ProjectType.REACT,
  publishOptions: {
    outputPath: 'dist',
  },
  assets: [
    {
      fileType: 'png',
      name: 'icons-192',
      content: base64File,
      path: ['custom'],
    },
    {
      fileType: 'png',
      name: 'icons-512',
      content: base64File,
      contentEncoding: 'base64',
    },
    {
      content: 'https://placekitten.com/800/400',
      name: 'kitten.png',
      location: 'remote',
      path: ['one', 'two'],
    },
    {
      content:
        'https://storage.googleapis.com/playground-bucket-v2.teleporthq.io/8db63146-c3cc-47b2-a38d-1f2b39418d4e/8f055b25-4689-4305-b41a-0655571542ca',
      name: 'super-funky.ttf',
      location: 'remote',
      path: ['fonts'],
    },
  ],
}

const log = async (cb: () => Promise<string>) => {
  const t1 = performance.now()
  const framework = await cb()
  const t2 = performance.now()

  const time = t2 - t1
  console.info(chalk.greenBright(`${framework} -  ${time.toFixed(2)}`))
}

const project = (params: {
  projectType: ProjectType
  projectSlug: string
  plugins?: ProjectPlugin[]
  options?: PackerOptions
  uidl?: Record<string, unknown>
}) =>
  log(async () => {
    const { projectType, projectSlug, plugins = [], options = packerOptions, uidl } = params
    const { payload } = await packProject((uidl ?? projectUIDL) as ProjectUIDL, {
      ...options,
      projectType,
      plugins,
      publishOptions: {
        ...packerOptions.publishOptions,
        projectSlug,
      },
    })

    return JSON.stringify(
      {
        projectSlug,
        payload,
      },
      null,
      2
    )
  })

// Parse a KEY=value .env file into a plain object. Lines starting with `#`
// and empty lines are skipped. Values are taken verbatim (no quote
// unwrapping) because that's how `createEnvFiles` also writes them.
const parseDotEnv = (content: string): Record<string, string> => {
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

// Preserve the buyer-editable subset of the existing `.env` across regeneration.
// The generator strips `teleporthq.secrets.*` placeholders to empty strings
// via `resolveAuthEnvValue`, so without this hook every `yarn standalone`
// wipes out values the user manually set (Stripe / PayPal test keys, DB
// connection string, etc.). By injecting the on-disk values into
// `uidl.globals.env` BEFORE packing, those values survive regeneration.
// Only non-empty existing values are promoted, so new keys introduced by the
// generator still take their default (empty) state on first run.
const preserveExistingEnv = (uidl: ProjectUIDL, envPath: string): void => {
  if (!existsSync(envPath)) {
    return
  }
  let raw = ''
  try {
    raw = readFileSync(envPath, 'utf8')
  } catch {
    return
  }
  const existing = parseDotEnv(raw)
  // A well-formed ProjectUIDL always has `globals`, but the input fixture may
  // be a page/component UIDL (no `globals`) or a partially-built project. Guard
  // rather than crash on `uidl.globals.env` — env preservation is a best-effort
  // convenience, not a hard requirement of the run.
  if (!uidl.globals) {
    return
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
}

// Files/dirs that are NOT produced by the generator and must survive a clean:
// install artifacts and user-owned config. Everything else in the project dir
// is regenerated every run.
// `.vscode`, `.claude` and `CLAUDE.md` are editor/agent scaffolding dropped into
// the generated project by tooling (or by hand) — the generator never emits
// them, so wiping them would only cost the developer their setup.
// `.next` is deliberately NOT preserved: it is a pure build cache, and keeping
// it across a regeneration is how the "silent default _app" trap happens — a
// dev server running during the clean sees `pages/_app.js` vanish, resolves
// `private-next-pages/_app` to Next's BUILT-IN default `_app`, and caches that
// in `.next`. Pages keep hot-reloading (so everything LOOKS fine) while every
// app-level runtime shipped through `_app` (play-sound, model-viewer orbit
// reset, nav active links, global state providers…) is silently gone until the
// server restarts on a clean cache.
const PRESERVE_ON_CLEAN = new Set([
  'node_modules',
  '.env',
  '.env.local',
  '.git',
  'package-lock.json',
  'yarn.lock',
  '.vscode',
  '.claude',
  'CLAUDE.md',
])

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
const RESTART_DEV_SERVER_WARNING =
  "A dev server that watched the regeneration may have cached Next's default _app and silently " +
  'dropped every app-level runtime — the symptom is a provider that is plainly there in _app.js ' +
  'throwing "must be used within a Provider" at runtime.'

const cleanGeneratedFiles = (projectDir: string): boolean => {
  if (!existsSync(projectDir)) {
    return false
  }
  const hadNextCache = existsSync(join(projectDir, '.next'))
  for (const entry of readdirSync(projectDir)) {
    if (PRESERVE_ON_CLEAN.has(entry)) {
      continue
    }
    rmSync(join(projectDir, entry), { recursive: true, force: true })
  }
  if (hadNextCache) {
    console.warn(
      chalk.yellow(
        `\n[standalone] Wiped ${projectDir}/.next — if a dev server is running against this folder, RESTART it now.\n` +
          `${RESTART_DEV_SERVER_WARNING}\n`
      )
    )
  }
  return hadNextCache
}

// Directories inside the generated project that were never produced by the
// generator — scanning them would only report other people's code.
const IMPORT_SCAN_SKIPPED_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  // Editor/agent scaffolding the clean deliberately preserves (PRESERVE_ON_CLEAN)
  '.vscode',
  '.claude',
])

// Extensions whose CONTENT is parsed for import specifiers. Everything else is
// still collected (an import has to be able to resolve to a .css/.json/asset
// file), just not read from disk.
const IMPORT_SCAN_READ_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']

const collectFilesForImportScan = (
  dir: string,
  prefix = ''
): Array<{ path: string; content: string }> => {
  const entries: Array<{ path: string; content: string }> = []

  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry)

    if (statSync(absolute).isDirectory()) {
      if (IMPORT_SCAN_SKIPPED_DIRS.has(entry)) {
        continue
      }
      entries.push(...collectFilesForImportScan(absolute, `${prefix}${entry}/`))
      continue
    }

    const shouldRead = IMPORT_SCAN_READ_EXTENSIONS.some((extension) => entry.endsWith(extension))
    entries.push({
      path: `${prefix}${entry}`,
      content: shouldRead ? readFileSync(absolute, 'utf8') : '',
    })
  }

  return entries
}

// Fail the run when a generated file imports something that was never written.
// `next build` reports this as "Module not found: Can't resolve '<specifier>'"
// minutes later (or only once it reaches Vercel) with no hint about which
// plugin computed the path — this reports it right where it was generated. The
// project generator logs the same finding during generation; the exit code is
// what makes it impossible to scroll past.
const verifyLocalImports = (projectDir: string): void => {
  if (!existsSync(projectDir)) {
    return
  }

  let unresolved: LocalImports.UnresolvedLocalImport[] = []

  try {
    unresolved = LocalImports.findUnresolvedLocalImports(collectFilesForImportScan(projectDir))
  } catch (error) {
    // Never turn a good generation into a failed run because the CHECK broke.
    console.info(chalk.yellow(`\n[standalone] could not verify local imports: ${error}\n`))
    return
  }

  if (unresolved.length === 0) {
    return
  }

  console.info(
    chalk.red(`\n[standalone] ${LocalImports.formatUnresolvedLocalImports(unresolved)}\n`)
  )
  process.exitCode = 1
}

const run = async () => {
  // Reported twice in one session: the warning below is printed BEFORE ~1500
  // lines of generation output, so it scrolls away and the next thing anyone
  // sees is a runtime error that looks like a codegen bug. Repeat it last.
  let wipedNextCache = false
  let generatedProjectDir = ''
  try {
    if (packerOptions.publisher === PublisherType.DISK) {
      try {
        accessSync('dist')
      } catch {
        mkdirSync('dist')
      }
      const projectDir = join(__dirname, '..', 'dist', 'teleport-project-next')
      // Preserve the user's existing `.env` values before regeneration so
      // Stripe / PayPal / DB credentials survive the trip through the
      // generator's secret-placeholder resolver. Read it BEFORE the clean
      // (the clean keeps `.env` on disk anyway, but this also folds the values
      // back into the UIDL so the regenerated `.env` carries them forward).
      const existingEnvPath = join(projectDir, '.env')
      preserveExistingEnv(projectUIDL, existingEnvPath)
      // Wipe stale generated files so orphans from a previous run can't break
      // the build (this subsumes the old workflows-only cleanup).
      generatedProjectDir = projectDir
      wipedNextCache = cleanGeneratedFiles(projectDir)
    }

    await Promise.all([
      // project({
      //   projectType: ProjectType.HTML,
      //   projectSlug: 'teleport-project-html',
      //   plugins: [new ProjectPluginParseEmbed()],
      //   options: {
      //     ...packerOptions,
      //     strictHtmlWhitespaceSensitivity: false,
      //   },
      // }),
      project({ projectType: ProjectType.NEXT, projectSlug: 'teleport-project-next' }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: `teleport-project-next-embeds`,
      //   plugins: [new ProjectPluginParseEmbed()],
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: `teleport-project-next-embeds-with-css-modules`,
      //   plugins: [
      //     new ProjectPluginCSSModules({ framework: ProjectType.NEXT }),
      //     new ProjectPluginParseEmbed(),
      //   ],
      // }),
      // project({
      //   projectType: ProjectType.REACT,
      //   projectSlug: 'teleport-project-react',
      //   plugins: [new ProjectPluginParseEmbed()],
      // }),
      // project({
      //   projectType: ProjectType.NUXT,
      //   projectSlug: `teleport-project-nuxt-with-embeds`,
      //   plugins: [new ProjectPluginParseEmbed()],
      // }),
      // project({
      //   projectType: ProjectType.VUE,
      //   projectSlug: `teleport-project-vue-with-embeds`,
      //   plugins: [new ProjectPluginParseEmbed()],
      // }),
      // project({
      //   projectType: ProjectType.ANGULAR,
      //   projectSlug: `teleport-project-angular-with-embeds`,
      //   plugins: [new ProjectPluginParseEmbed()],
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: `teleport-project-next-with-reactjss`,
      //   plugins: [new ProjectPluginReactJSS({ framework: ProjectType.NEXT })],
      // }),
      // project({
      //   projectType: ProjectType.REACT,
      //   projectSlug: `teleport-project-react-with-styled-components`,
      //   plugins: [new ProjectPluginStyledComponents({ framework: ProjectType.REACT })],
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: 'teleport-project-contentful-cms',
      //   uidl: contentfulUIDL,
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: 'teleport-project-wordpress-cms',
      //   uidl: wordpressUIDL,
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: 'teleport-project-strapi-cms',
      //   uidl: strapiUIDL,
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: 'teleport-project-caisy-cms',
      //   uidl: caisyUIDL,
      // }),
      // project({
      //   projectType: ProjectType.NEXT,
      //   projectSlug: 'teleport-project-flotiq-cms',
      //   uidl: flotiqUIDL,
      // }),
    ])

    if (generatedProjectDir) {
      verifyLocalImports(generatedProjectDir)
    }

    // ⛔ The clean deletes `.next`, so nothing this script does can recreate it.
    // If it is back by the time generation finishes, a dev server was WATCHING
    // the regeneration — and it rebuilt the cache during the window where
    // `pages/_app.js` did not exist, which is exactly how Next's built-in
    // default `_app` gets baked in. Killing that server is then not enough: the
    // poisoned cache outlives it and the next server inherits it. Measured: a
    // fresh server on the inherited cache still threw "useGlobalState must be
    // used within a GlobalStateProvider" on every page; the same server on a
    // deleted cache served them all.
    if (generatedProjectDir && existsSync(join(generatedProjectDir, '.next'))) {
      console.warn(
        chalk.red(
          `\n[standalone] A dev server was RUNNING during this regeneration — ${generatedProjectDir}/.next came back on its own.\n` +
            `That cache is poisoned. Stop the server, delete .next, and only then start it again:\n` +
            `  rm -rf ${generatedProjectDir}/.next\n` +
            `${RESTART_DEV_SERVER_WARNING}\n`
        )
      )
    } else if (wipedNextCache) {
      console.warn(
        chalk.yellow(
          `\n[standalone] RESTART any dev server running against dist/teleport-project-next.\n` +
            `${RESTART_DEV_SERVER_WARNING}\n`
        )
      )
    }
  } catch (e) {
    // A generation failure wipes the whole output (the clean above already ran),
    // so swallowing it here made `npm run standalone` print a SyntaxError and
    // still exit 0 — a silent build break that no CI check could catch. Report
    // it and fail the process. `console.info` rather than `console.error`
    // because the repo's tslint config bans the latter — the non-zero exit code
    // below is what CI actually reads, and chalk keeps it loud for a human.
    console.info(chalk.red((e as Error)?.stack ?? String(e)))
    process.exitCode = 1
  }
}

run()
