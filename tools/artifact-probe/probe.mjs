#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'

import { probeArtifact } from './src/probe.mjs'
import { resolveCredentials } from './src/auth.mjs'

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
      case '--email':
        args.email = readValue()
        break
      case '--password':
        args.password = readValue()
        break
      case '--no-auth':
        args.noAuth = true
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
  // "OK" on its own would be read as "the whole app is fine". It only ever means
  // "no defects in what was actually looked at", so when coverage is partial the
  // headline has to say so — the numbers underneath are too easy to skim past.
  const unverified = report.totals.routesNotVerified ?? 0
  if (!report.ok) {
    lines.push('ARTIFACT PROBLEMS')
  } else if (unverified > 0) {
    lines.push(
      `ARTIFACT OK for the ${report.totals.routesProbed} route(s) verified — ` +
        `${unverified} route(s) were NOT checked, so this is partial coverage`
    )
  } else {
    lines.push('ARTIFACT OK — builds, boots, renders, nothing hidden')
  }
  report.verdicts.forEach((verdict) => lines.push(`  • ${verdict}`))

  lines.push('')
  lines.push(
    `  build ${report.build.ok ? 'ok' : 'FAILED'} in ${(report.build.durationMs / 1000).toFixed(
      1
    )}s` +
      ` · shared JS ${report.build.sharedJsKb ?? '?'} kB` +
      ` · ${report.totals.routesProbed} route(s) verified` +
      (report.totals.routesNotVerified ? ` · ${report.totals.routesNotVerified} NOT verified` : '')
  )

  if (!report.build.ok) {
    report.build.errors.slice(0, 12).forEach((line) => lines.push(`    ${line}`))
    return lines.join('\n')
  }

  report.routes
    .filter((route) => !route.skipped)
    .forEach((route) => {
      const flags = []
      if (route.redirectedTo) {
        // Never let a route that was never seen print as "clean".
        lines.push(
          `  ${pad(route.path, 30)} ${' '.repeat(6)}     ${
            route.forbidden ? 'FORBIDDEN (role)' : 'NOT VERIFIED'
          } → ${route.redirectedTo}`
        )
        return
      }
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

  // Protected routes are only observable with a session. Resolved before the
  // run so a first-time prompt happens up front rather than minutes in.
  let auth = null
  if (!args.noAuth) {
    auth = await resolveCredentials({
      projectDir,
      email: args.email,
      password: args.password,
      interactive: true,
    })
    process.stderr.write(`Auth identity: ${auth.email} (from ${auth.source})\n`)
  }

  const report = await probeArtifact({
    projectDir,
    auth,
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
