import * as fs from 'fs'
import * as path from 'path'
import * as ts from 'typescript'
import {
  PROTECTED_ENV_NAMES,
  PROTECTED_ENV_NAME_PATTERN,
  PLATFORM_ENV_NAME_PATTERN,
  INTEGRATION_ENV_NAME_PATTERN,
  SANDBOX_ESCAPE_PATTERNS,
} from '../src/security-scanner'
import { generalCustomJs } from '../src/nodes/general/general-custom-js'

/**
 * The custom-JS security lists are kept in several copies, one per checkpoint:
 * the editor (teleport-gui `workflow-schema`), the publish gate
 * (teleport-services-worker), the codegen gate (`security-scanner.ts`) and the
 * runtime `process` shadow inlined in the custom-JS handler. A name or a
 * pattern added to one and not the others is a hole at that checkpoint, so
 * this spec reads every copy by path and fails when they drift. It also holds
 * the rule that every secret TeleportHQ keeps for the site (the system-managed
 * list, GUI and worker) is protected from custom JS.
 *
 * The GUI and worker copies are read from the sibling checkouts
 * (`<workspace>/teleport-gui`, `<workspace>/teleport-services-worker`). A
 * checkout of this repository alone skips those comparisons, saying so; in a
 * checkout that has the sibling, a copy that is not where this spec looks
 * fails ("copy not found at <path>") — a moved copy is never left unchecked.
 */

const WORKSPACE = path.resolve(__dirname, '..', '..', '..', '..')
const GUI = path.join(WORKSPACE, 'teleport-gui')
const WORKER = path.join(WORKSPACE, 'teleport-services-worker')

const GUI_FILES = {
  protectedNames: path.join(GUI, 'packages/workflow-schema/src/security/protected-env-names.ts'),
  sandboxEscapes: path.join(
    GUI,
    'packages/workflow-schema/src/security/sandbox-escape-patterns.ts'
  ),
  systemManaged: path.join(GUI, 'apps/gui/app/utils/string.ts'),
  platformInternal: path.join(GUI, 'apps/gui/app/utils/platform-internal-secrets.ts'),
}
const WORKER_FILES = {
  protectedNames: path.join(WORKER, 'src/modules/vercel/security/protected-env-names.ts'),
  sandboxEscapes: path.join(WORKER, 'src/modules/vercel/security/sandbox-escape-patterns.ts'),
  systemManaged: path.join(WORKER, 'src/api/middlewares/system-managed-secrets.ts'),
  platformInternal: path.join(WORKER, 'src/modules/project/platform-internal-secrets.ts'),
}

/** Whether a sibling repository is checked out: its root, not any one file. */
const isCheckedOut = (root: string): boolean => fs.existsSync(path.join(root, 'package.json'))

/** A repository's copies, or — only when the repository is absent — a skipped describe that says why. */
const describeCopiesOf = (repo: string, root: string) => {
  if (isCheckedOut(root)) {
    return describe
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[security-lists-parity] SKIPPED the ${repo} copies: ${root} is not checked out next to ` +
      'teleport-code-generators.'
  )
  return describe.skip
}

/**
 * Evaluates a TypeScript source file for its exported constants. The files
 * read here import types only (or modules their functions use when called,
 * which these checks never do), so every require answers an empty module.
 */
const loadTs = (file: string): Record<string, any> => {
  if (!fs.existsSync(file)) {
    throw new Error(`copy not found at ${file}`)
  }
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  })
  const module = { exports: {} as Record<string, any> }
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', outputText)(module, module.exports, () => ({}))
  return module.exports
}

const describePatterns = (
  patterns: ReadonlyArray<{ ruleId: string; message: string; pattern: RegExp }>
) =>
  patterns.map(({ ruleId, message, pattern }) => ({
    ruleId,
    message,
    source: pattern.source,
    flags: pattern.flags,
  }))

/** A pattern as it matches: a flag (`g` keeps state between tests, `i` widens) is drift too. */
const patternOf = (pattern: RegExp) => ({ source: pattern.source, flags: pattern.flags })

const CODEGEN = {
  names: [...PROTECTED_ENV_NAMES],
  pattern: patternOf(PROTECTED_ENV_NAME_PATTERN),
  platformPattern: patternOf(PLATFORM_ENV_NAME_PATTERN),
  integrationPattern: patternOf(INTEGRATION_ENV_NAME_PATTERN),
  escapes: describePatterns(SANDBOX_ESCAPE_PATTERNS),
}

/**
 * The names the integrations store (and look-alikes that are not theirs), to
 * hold the custom-JS rule to the rule that decides which stored secrets are an
 * integration's (`platform-internal-secrets.ts`, worker and GUI).
 */
const INTEGRATION_NAME_SAMPLES = [
  '__gsc_access',
  '__gsc_refresh',
  '__gsc_keyword_audit',
  '__google_merchant_refresh',
  '__social_oauth_linkedin_access',
  '__social_oauth_instagram_story_refresh',
  'MAILCHIMP_API_KEY',
  'MY__KEY',
  '_single',
  'gsc_access',
]

/** The custom-JS rule and a copy's `isPlatformInternalSecretName` agree on every sample. */
const expectIntegrationRuleMatches = (file: string) => {
  const isInternal = loadTs(file).isPlatformInternalSecretName as (name: string) => boolean
  expect(INTEGRATION_NAME_SAMPLES.filter(isInternal)).toEqual(
    INTEGRATION_NAME_SAMPLES.filter((name) => INTEGRATION_ENV_NAME_PATTERN.test(name))
  )
  expect(INTEGRATION_NAME_SAMPLES.filter(isInternal)).toHaveLength(6)
}

/** The shadow's regex literal named `name`, as `{ source, flags }`. */
const shadowPatternOf = (handler: string, name: string) => {
  const literal = new RegExp(`var ${name} = /(.+)/([a-z]*);`).exec(handler)
  return literal ? { source: literal[1], flags: literal[2] } : null
}

/** Protected in custom JS: by name, or by the TELEPORT_DB_ rule. */
const isProtectedPlatformName = (name: string): boolean =>
  CODEGEN.names.indexOf(name as (typeof CODEGEN.names)[number]) !== -1 ||
  PLATFORM_ENV_NAME_PATTERN.test(name)

describe('the runtime process shadow in general-custom-js', () => {
  const handler = generalCustomJs.generateHandler()
  const start = handler.indexOf('var __TQ_PROTECTED = {')
  const end = handler.indexOf('var __TQ_PROTECTED_RE')

  it('hides exactly the protected names', () => {
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const shadowed = (handler.slice(start, end).match(/"[A-Z][A-Z0-9_]*":1/g) || []).map((entry) =>
      entry.slice(1, entry.indexOf('"', 1))
    )
    expect(shadowed).toEqual(CODEGEN.names)
  })

  it('hides the payment credentials by the same pattern, with no flags', () => {
    expect(CODEGEN.pattern.flags).toBe('')
    expect(shadowPatternOf(handler, '__TQ_PROTECTED_RE')).toEqual(CODEGEN.pattern)
  })

  it('hides every TELEPORT_DB_ name by the same rule, with no flags', () => {
    expect(CODEGEN.platformPattern.flags).toBe('')
    expect(shadowPatternOf(handler, '__TQ_PROTECTED_PLATFORM_RE')).toEqual(CODEGEN.platformPattern)
  })

  it("hides every integration's __ name by the same rule, with no flags", () => {
    expect(CODEGEN.integrationPattern.flags).toBe('')
    expect(shadowPatternOf(handler, '__TQ_PROTECTED_INTEGRATION_RE')).toEqual(
      CODEGEN.integrationPattern
    )
    expect(handler).toContain('__TQ_PROTECTED_INTEGRATION_RE.test(k)')
  })
})

describeCopiesOf('teleport-gui', GUI)('the editor copies (teleport-gui)', () => {
  it('protect the same env names and credential pattern', () => {
    const copy = loadTs(GUI_FILES.protectedNames)
    expect([...copy.PROTECTED_ENV_NAMES].sort()).toEqual([...CODEGEN.names].sort())
    expect(patternOf(copy.PROTECTED_ENV_NAME_PATTERN)).toEqual(CODEGEN.pattern)
    expect(patternOf(copy.PLATFORM_ENV_NAME_PATTERN)).toEqual(CODEGEN.platformPattern)
    expect(patternOf(copy.INTEGRATION_ENV_NAME_PATTERN)).toEqual(CODEGEN.integrationPattern)
  })

  it("protect exactly the names the editor treats as an integration's", () => {
    expectIntegrationRuleMatches(GUI_FILES.platformInternal)
  })

  it('protect every secret name the editor reserves for the platform database', () => {
    const reserved: string[] = Array.from(loadTs(GUI_FILES.systemManaged).RESERVED_SECRET_NAMES)
    expect(reserved.length).toBeGreaterThan(0)
    expect(reserved.filter((name) => !isProtectedPlatformName(name))).toEqual([])
  })

  it('refuse the same sandbox escapes', () => {
    expect(describePatterns(loadTs(GUI_FILES.sandboxEscapes).SANDBOX_ESCAPE_PATTERNS)).toEqual(
      CODEGEN.escapes
    )
  })

  it('protect every secret the editor lists as system-managed', () => {
    const managed: string[] = Array.from(
      loadTs(GUI_FILES.systemManaged).SYSTEM_MANAGED_SECRET_NAMES
    )
    expect(managed.length).toBeGreaterThan(0)
    expect(CODEGEN.names).toEqual(expect.arrayContaining(managed))
  })
})

describeCopiesOf('teleport-services-worker', WORKER)(
  'the publish gate copies (teleport-services-worker)',
  () => {
    it('protect the same env names and credential pattern', () => {
      const copy = loadTs(WORKER_FILES.protectedNames)
      expect([...copy.PROTECTED_ENV_NAMES].sort()).toEqual([...CODEGEN.names].sort())
      expect(patternOf(copy.PROTECTED_ENV_NAME_PATTERN)).toEqual(CODEGEN.pattern)
      expect(patternOf(copy.PLATFORM_ENV_NAME_PATTERN)).toEqual(CODEGEN.platformPattern)
      expect(patternOf(copy.INTEGRATION_ENV_NAME_PATTERN)).toEqual(CODEGEN.integrationPattern)
    })

    it("protect exactly the names the worker treats as an integration's", () => {
      expectIntegrationRuleMatches(WORKER_FILES.platformInternal)
    })

    it('refuse the same sandbox escapes', () => {
      expect(describePatterns(loadTs(WORKER_FILES.sandboxEscapes).SANDBOX_ESCAPE_PATTERNS)).toEqual(
        CODEGEN.escapes
      )
    })

    it('protect every secret the worker keeps as system-managed', () => {
      const managed: string[] = Array.from(
        loadTs(WORKER_FILES.systemManaged).SYSTEM_MANAGED_SECRET_NAMES
      )
      expect(managed.length).toBeGreaterThan(0)
      expect(CODEGEN.names).toEqual(expect.arrayContaining(managed))
      // The editor shows the same names read-only.
      if (isCheckedOut(GUI)) {
        expect([...managed].sort()).toEqual(
          Array.from(loadTs(GUI_FILES.systemManaged).SYSTEM_MANAGED_SECRET_NAMES).sort()
        )
      }
    })
  }
)
