import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import chalk from 'chalk'
import { ProjectType, ProjectUIDL } from '@teleporthq/teleport-types'

import { describeStaleness, findStalePackages } from './build-freshness'
import { generateProject, GenerateProjectResult } from './generate-project'

/**
 * `yarn generate` — pack any UIDL, from any path, into any output directory.
 *
 * The reusable entry point for everything that is not "the dev running the
 * checked-in fixture": the GUI's Teleport & Run button, the artifact prober, CI.
 * `yarn standalone` is the same core with the fixture path filled in.
 *
 *   yarn generate --uidl ./my-project.json
 *   yarn generate --uidl ./my-project.json --env ./secrets.env --slug my-app --json
 *
 * Flags:
 *   --uidl <path>          project UIDL JSON (required)
 *   --env <path>           .env whose values are folded back in before packing
 *                          (default: `<out>/<slug>/.env`, i.e. the previous run's)
 *   --out <dir>            output ROOT; the project lands in <dir>/<slug>
 *                          (default: <package>/dist)
 *   --slug <name>          output folder name (default: teleport-project-next)
 *   --project-type <type>  next | react | vue | nuxt | angular | html
 *                          (default: next — the only type the loop supports today)
 *   --json                 print the machine-readable result as a single line of
 *                          stdout, so it survives the generators' own chatter
 *   --json-out <path>      also write that result to a file. PREFER THIS for any
 *                          programmatic caller: `yarn` appends its own
 *                          "Done in Ns." line, so "the last line of stdout" is
 *                          not a contract you can rely on through a yarn script.
 *
 * Exit code is 0 only when generation succeeded, so a caller can branch on it
 * without parsing anything.
 */

interface CliArgs {
  uidl?: string
  env?: string
  out?: string
  slug?: string
  projectType?: string
  json: boolean
  jsonOut?: string
}

const parseArgs = (argv: string[]): CliArgs => {
  const args: CliArgs = { json: false }

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const readValue = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for ${flag}`)
      }
      index += 1
      return value
    }

    switch (flag) {
      case '--uidl':
        args.uidl = readValue()
        break
      case '--env':
        args.env = readValue()
        break
      case '--out':
        args.out = readValue()
        break
      case '--slug':
        args.slug = readValue()
        break
      case '--project-type':
        args.projectType = readValue()
        break
      case '--json':
        args.json = true
        break
      case '--json-out':
        args.jsonOut = readValue()
        break
      default:
        throw new Error(`Unknown argument "${flag}"`)
    }
  }

  return args
}

const PROJECT_TYPES = Object.values(ProjectType) as string[]

const resolveProjectType = (value: string | undefined): ProjectType => {
  if (!value) {
    return ProjectType.NEXT
  }
  const normalized = value.toLowerCase()
  if (!PROJECT_TYPES.includes(normalized)) {
    throw new Error(`Unknown --project-type "${value}". Known: ${PROJECT_TYPES.join(', ')}`)
  }
  return normalized as ProjectType
}

const readUidl = (uidlPath: string): ProjectUIDL => {
  if (!existsSync(uidlPath)) {
    throw new Error(`UIDL not found at ${uidlPath}`)
  }
  const raw = readFileSync(uidlPath, 'utf8')
  try {
    return JSON.parse(raw) as ProjectUIDL
  } catch (error) {
    throw new Error(`UIDL at ${uidlPath} is not valid JSON: ${(error as Error).message}`)
  }
}

const run = async () => {
  let args: CliArgs
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${chalk.red((error as Error).message)}\n`)
    process.exitCode = 2
    return
  }

  const note = (message: string) => {
    process.stderr.write(`${message}\n`)
  }

  const report = (outcome: GenerateProjectResult) => {
    if (args.jsonOut) {
      const jsonOut = resolve(args.jsonOut)
      mkdirSync(dirname(jsonOut), { recursive: true })
      writeFileSync(jsonOut, `${JSON.stringify(outcome, null, 2)}\n`, 'utf8')
    }
    if (args.json) {
      // Single line: the generators print their own diagnostics to stdout while
      // packing, so "the last line of stdout" is the only stable contract.
      process.stdout.write(`${JSON.stringify(outcome)}\n`)
      return
    }
    if (outcome.ok) {
      outcome.warnings.forEach((warning) => note(chalk.yellow(warning)))
      note(
        chalk.greenBright(
          `${outcome.slug} — ${outcome.fileCount} files, ${(outcome.byteCount / 1024).toFixed(
            1
          )} KB, ${
            outcome.warnings.length
          } generator warning(s) in ${outcome.timings.totalMs.toFixed(0)}ms → ${outcome.projectDir}`
        )
      )
      return
    }
    note(chalk.red(outcome.error?.stack ?? outcome.error?.message ?? 'generation failed'))
  }

  if (!args.uidl) {
    note(chalk.red('--uidl <path> is required'))
    process.exitCode = 2
    return
  }

  const slug = args.slug || 'teleport-project-next'
  const outRoot = resolve(args.out || join(__dirname, '..', 'dist'))
  const projectDir = join(outRoot, slug)

  let projectType: ProjectType
  let uidl: ProjectUIDL
  try {
    projectType = resolveProjectType(args.projectType)
    uidl = readUidl(resolve(args.uidl))
  } catch (error) {
    report({
      ok: false,
      slug,
      projectType: args.projectType || ProjectType.NEXT,
      projectDir,
      fileCount: 0,
      byteCount: 0,
      preservedEnvKeys: 0,
      warnings: [],
      timings: { cleanMs: 0, packMs: 0, totalMs: 0 },
      error: { message: (error as Error).message },
    })
    process.exitCode = 1
    return
  }

  // Generation runs each package's `dist/`, not its `src/`. Saying so loudly
  // beats letting someone debug generated output against source it was never
  // built from.
  const stale = findStalePackages(join(__dirname, '..', '..'))
  if (stale.length > 0) {
    note(chalk.yellow(describeStaleness(stale)))
  }

  note(chalk.gray(`Packing ${projectType} project "${slug}" → ${projectDir}`))

  const result = await generateProject({
    uidl,
    outRoot,
    slug,
    projectType,
    envPath: args.env ? resolve(args.env) : join(projectDir, '.env'),
  })

  report({ ...result, staleGenerators: stale })
  if (!result.ok) {
    process.exitCode = 1
  }
}

run()
