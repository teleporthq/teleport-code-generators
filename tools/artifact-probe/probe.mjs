#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'

import { probeArtifact } from './src/probe.mjs'

/**
 * CLI for the artifact probe. See README.md.
 *
 * Everything human goes to stderr and the report to a file, so `--json` output
 * on stdout stays parseable.
 */

const parseArgs = (argv) => {
  const args = { port: 4321, skipInstall: false, maxRoutes: 25, screenshots: true, json: false }

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
      case '--project':
        args.project = readValue()
        break
      case '--report':
        args.report = readValue()
        break
      case '--port':
        args.port = Number(readValue())
        break
      case '--max-routes':
        args.maxRoutes = Number(readValue())
        break
      case '--skip-install':
        args.skipInstall = true
        break
      case '--no-screenshots':
        args.screenshots = false
        break
      case '--json':
        args.json = true
        break
      default:
        throw new Error(`Unknown argument "${flag}"`)
    }
  }

  return args
}

const pad = (value, width) => String(value).padEnd(width)

const summarize = (report) => {
  const lines = []
  lines.push(
    report.ok ? 'ARTIFACT OK — builds, boots, renders, nothing hidden' : 'ARTIFACT PROBLEMS'
  )
  report.verdicts.forEach((verdict) => lines.push(`  • ${verdict}`))

  lines.push('')
  lines.push(
    `  build ${report.build.ok ? 'ok' : 'FAILED'} in ${(report.build.durationMs / 1000).toFixed(
      1
    )}s` +
      ` · shared JS ${report.build.sharedJsKb ?? '?'} kB` +
      ` · ${report.totals.routesProbed} route(s) probed`
  )

  if (!report.build.ok) {
    report.build.errors.slice(0, 12).forEach((line) => lines.push(`    ${line}`))
    return lines.join('\n')
  }

  report.routes
    .filter((route) => !route.skipped)
    .forEach((route) => {
      const flags = []
      if (route.status !== null && route.status >= 400 && !['/404', '/500'].includes(route.path)) {
        flags.push(`HTTP ${route.status}`)
      }
      if (route.hydrationErrors.length) {
        flags.push(`${route.hydrationErrors.length} hydration`)
      }
      if (route.pageErrors.length) {
        flags.push(`${route.pageErrors.length} throw`)
      }
      if (route.consoleErrors.length) {
        flags.push(`${route.consoleErrors.length} console`)
      }
      if (route.hiddenContent.length) {
        flags.push(`${route.hiddenContent.length} HIDDEN`)
      }
      if (route.revealedByScroll) {
        flags.push(`${route.revealedByScroll} revealed-on-scroll`)
      }
      lines.push(
        `  ${pad(route.path, 30)} ${String(route.firstLoadKb ?? '?').padStart(6)} kB  ${
          flags.join(' · ') || 'clean'
        }`
      )
    })

  return lines.join('\n')
}

const run = async () => {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 2
    return
  }

  if (!args.project) {
    process.stderr.write('--project <dir> is required\n')
    process.exitCode = 2
    return
  }

  const projectDir = resolve(args.project)
  // Beside the project, never inside it: `yarn standalone` wipes the project
  // tree on every file save while the generators are being worked on.
  const reportPath = resolve(args.report || `${projectDir}.artifact-report.json`)

  process.stderr.write(`Probing ${projectDir}\n`)

  const report = await probeArtifact({
    projectDir,
    port: args.port,
    screenshotDir: args.screenshots ? `${projectDir}.artifact-screens` : undefined,
    skipInstall: args.skipInstall,
    maxRoutes: args.maxRoutes,
    onProgress: (message) => process.stderr.write(`  ${message}\n`),
  })

  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  process.stderr.write(`\n${summarize(report)}\n\nReport: ${reportPath}\n`)

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`)
  }

  // Exit explicitly. Setting `process.exitCode` alone waits for the event loop
  // to drain, and a browser that ignored `close()` keeps a handle open forever —
  // the process then sits there, done but alive, holding the probed server with
  // it. The report is fully written by this point, so there is nothing to lose.
  process.exit(report.ok ? 0 : 1)
}

run()
