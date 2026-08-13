import { spawn } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { createConnection } from 'net'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Host-process keys that must not describe a child. `__NEXT_PROCESSED_ENV` is
 * the dangerous one: `@next/env`'s `processEnv()` short-circuits on it, so a
 * Next app spawned from inside another Next process reads its `.env` off disk
 * and then discards every key. The app then runs with no database connection
 * string and no auth secrets, and the failure surfaces as a libpq error about a
 * database named after the OS user — nothing that points at env loading at all.
 *
 * This probe runs `next build` and `next start`, so it strips them for the same
 * reason the GUI's Teleport & Run route does.
 */
const HOST_ONLY_ENV_KEYS = [
  '__NEXT_PROCESSED_ENV',
  '__NEXT_OPTIMIZE_FONTS',
  'NEXT_RUNTIME',
  'NODE_ENV',
  'INIT_CWD',
]
const HOST_ONLY_ENV_PREFIXES = ['__NEXT', 'NEXT_PUBLIC_', 'npm_']

export const childEnv = (extra = {}) => {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (
      HOST_ONLY_ENV_KEYS.includes(key) ||
      HOST_ONLY_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      delete env[key]
    }
  }
  return { ...env, ...extra }
}

export const runCommand = ({ command, args, cwd, timeoutMs, env, onLine }) =>
  new Promise((resolve) => {
    const startedAt = Date.now()
    const child = spawn(command, args, { cwd, env: env ?? childEnv() })

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    const collect = (target) => (chunk) => {
      const text = chunk.toString()
      if (target === 'stdout') {
        stdout += text
      } else {
        stderr += text
      }
      if (onLine) {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) {
            onLine(line)
          }
        }
      }
    }

    child.stdout.on('data', collect('stdout'))
    child.stderr.on('data', collect('stderr'))
    child.on('error', (error) => {
      stderr += `\n${error.message}`
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        command: `${command} ${args.join(' ')}`.trim(),
        code,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      })
    })
  })

const canConnect = (port) =>
  new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    socket.setTimeout(1000)
    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })
    const fail = () => {
      socket.destroy()
      resolve(false)
    }
    socket.on('error', fail)
    socket.on('timeout', fail)
  })

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Boot a long-running server and wait until the port actually accepts a
 * connection. Resolves a null handle when the process died or never came up, so
 * the caller reports a boot failure instead of probing a port serving nothing.
 */
export const startServer = async ({ command, args, cwd, port, timeoutMs }) => {
  // `detached` makes the child its own process-group leader so the whole group
  // can be killed at once. `npm run start` is a shell wrapper around `next
  // start`: killing the wrapper alone orphans the real server, which then holds
  // the port until someone notices. Two of those survived a probe run and sat
  // there for the better part of an hour.
  const child = spawn(command, args, {
    cwd,
    env: childEnv({ PORT: String(port) }),
    detached: true,
  })

  let output = ''
  let exited = false
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.on('error', (error) => {
    output += `\n${error.message}`
    exited = true
  })
  child.on('close', () => {
    exited = true
  })

  const handle = {
    stop: () => {
      if (exited) {
        return
      }
      try {
        // Negative pid = the whole process group, so `next start` goes too.
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }
    },
    output: () => output,
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (exited) {
      return { handle: null, output }
    }
    if (await canConnect(port)) {
      // The port opens a beat before the first request can be served.
      await delay(500)
      return { handle, output }
    }
    await delay(300)
  }

  handle.stop()
  return { handle: null, output }
}

/**
 * Chrome the probe can drive. `playwright-core` ships no browser, so one has to
 * be found on the machine.
 *
 * "Chrome for Testing" builds are preferred over the developer's own Chrome.
 * The branded app carries a real user profile, an update service and first-run
 * machinery; driving it is slow and it does not always exit when told to — an
 * early run left `browser.close()` hanging and the probed server alive for half
 * an hour. Chrome for Testing exists precisely to avoid that.
 */
const puppeteerCacheCandidates = () => {
  const cacheRoot = join(homedir(), '.cache', 'puppeteer', 'chrome')
  if (!existsSync(cacheRoot)) {
    return []
  }
  let versions = []
  try {
    versions = readdirSync(cacheRoot).sort().reverse()
  } catch {
    return []
  }
  return versions.flatMap((version) => [
    join(
      cacheRoot,
      version,
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing'
    ),
    join(
      cacheRoot,
      version,
      'chrome-mac-x64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing'
    ),
    join(cacheRoot, version, 'chrome-linux64', 'chrome'),
  ])
}

export const resolveBrowserExecutable = () => {
  if (process.env.ARTIFACT_PROBE_BROWSER) {
    return existsSync(process.env.ARTIFACT_PROBE_BROWSER)
      ? process.env.ARTIFACT_PROBE_BROWSER
      : null
  }
  const candidates = [
    ...puppeteerCacheCandidates(),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** Flags that keep an automated Chrome from behaving like a desktop app. */
export const BROWSER_LAUNCH_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-extensions',
]
