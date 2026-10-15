/**
 * Runtime helpers that ship as TEXT inside generated projects, derived from
 * their typed sources at build time.
 *
 * Some emitted components (the scroll-scene widget, the page-transition
 * wrapper, the workflow AI segments) include helper functions that also run
 * here, typed and tested. They used to be spliced in with
 * `Function.prototype.toString()`. That reads the function the BUNDLER left
 * behind: the editor packs the generators with webpack + Terser, which renames
 * every module-level function to a one-letter name, so an export made from the
 * editor's production build carried four `function r` declarations and no
 * `settledMomentForLanes` at all (Vercel build error on 2026-10-06, generators
 * 0.43.71–0.43.73).
 *
 * This script compiles each listed function with TypeScript itself and writes
 * the result into a generated module next to its source. Emitters splice THAT
 * string, which no bundler touches. Each generated module has a drift test
 * that fails until this script has been run again.
 *
 * Usage: node scripts/function-sources.js          (rewrites every module)
 *        node scripts/function-sources.js --check  (exit 1 when any is stale)
 */
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const prettier = require('prettier')

const ROOT = path.resolve(__dirname, '..')

/** Every generated module: where it goes, what it exports, and which functions it carries. */
const MANIFEST = [
  {
    output: 'packages/teleport-shared/src/scroll-scene/helper-sources.generated.ts',
    exportName: 'SCROLL_SCENE_HELPER_SOURCES',
    target: 'ES5',
    sources: [
      { file: 'packages/teleport-shared/src/scroll-scene/moment.ts', names: ['settledMomentForLanes'] },
      { file: 'packages/teleport-shared/src/scroll-scene/chapter-index.ts', names: ['activeChapterIndex'] },
      {
        file: 'packages/teleport-shared/src/scroll-scene/points.ts',
        names: ['scenePointList', 'passedScenePoints', 'scenePointRank'],
      },
      { file: 'packages/teleport-shared/src/scroll-scene/unclip.ts', names: ['unclipStickyAncestors'] },
    ],
  },
  {
    output: 'packages/teleport-shared/src/page-transition/variant-sources.generated.ts',
    exportName: 'PAGE_TRANSITION_HELPER_SOURCES',
    target: 'ES5',
    sources: [
      {
        file: 'packages/teleport-shared/src/page-transition/variants.ts',
        names: [
          'reversePageTransitionPreset',
          'pageTransitionVariants',
          'pageTransitionCover',
          'pageTransitionSkipPattern',
        ],
      },
    ],
  },
  {
    output: 'packages/teleport-project-generator-next/src/page-transition/reveal-on-screen-source.generated.ts',
    exportName: 'REVEAL_ON_SCREEN_SOURCES',
    target: 'ES5',
    sources: [
      {
        file: 'packages/teleport-project-generator-next/src/page-transition/reveal-on-screen.ts',
        names: ['revealOnScreen'],
      },
    ],
  },
  {
    output: 'packages/teleport-plugin-next-workflows/src/nodes/ai/ai-provider-utils-sources.generated.ts',
    exportName: 'AI_PROVIDER_UTIL_SOURCES',
    target: 'ES2017',
    sources: [
      {
        file: 'packages/teleport-plugin-next-workflows/src/nodes/ai/ai-provider-utils.ts',
        names: [
          '__ai_resolveTextField',
          '__ai_resolveToken',
          '__ai_detectProvider',
          '__ai_resolveProvider',
          '__ai_modelCapabilities',
          '__ai_providerBaseURL',
          '__ai_openAICompatibleBody',
          '__ai_clampTemperature',
          '__ai_parseJSON',
          '__ai_callProvider',
        ],
      },
    ],
  },
  {
    output: 'packages/teleport-plugin-next-workflows/src/nodes/ai/ai-sql-select-guard-sources.generated.ts',
    exportName: 'AI_SQL_SELECT_GUARD_SOURCES',
    target: 'ES2017',
    sources: [
      {
        file: 'packages/teleport-plugin-next-workflows/src/nodes/ai/ai-sql-select-guard.ts',
        names: [
          '__aisql_stripLiteralsAndComments',
          '__aisql_validateSelectQuery',
          '__aisql_enforceLimit',
          '__aisql_buildSystemPrompt',
        ],
      },
    ],
  },
]

/** A helper that would need one of tsc's downlevel helpers cannot ship as text on its own. */
const TSC_HELPER = /\b__(assign|spreadArray|spread|values|read|rest|extends|awaiter|generator|asyncValues|makeTemplateObject)\b/

const TARGETS = { ES5: ts.ScriptTarget.ES5, ES2017: ts.ScriptTarget.ES2017 }

/** The compiled text of the named function declarations in one TypeScript file. */
function functionSourcesOf(file, names, target) {
  const absolute = path.join(ROOT, file)
  const { outputText } = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    fileName: absolute,
    compilerOptions: {
      target: TARGETS[target],
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      importHelpers: false,
    },
  })
  const compiled = ts.createSourceFile(absolute, outputText, TARGETS[target], true)
  const found = {}
  for (const statement of compiled.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) {
      continue
    }
    const name = statement.name.text
    if (!names.includes(name)) {
      continue
    }
    const text = outputText.slice(statement.getStart(compiled), statement.end).replace(/^export\s+/, '')
    const helper = text.match(TSC_HELPER)
    if (helper) {
      throw new Error(
        `${file}: ${name} compiles to a call of tsc's ${helper[0]} helper, which the generated text would not carry. Write it in plain ${target}.`
      )
    }
    found[name] = text
  }
  const missing = names.filter((name) => !found[name])
  if (missing.length > 0) {
    throw new Error(`${file}: no top-level function declaration named ${missing.join(', ')}`)
  }
  return names.map((name) => [name, found[name]])
}

/** The sources one generated module carries, in manifest order. */
function renderSources(entry) {
  return entry.sources.flatMap(({ file, names }) => functionSourcesOf(file, names, entry.target))
}

/** The module's text as the repo formats it, so the pre-commit formatter leaves it untouched. */
function renderModule(entry) {
  const absolute = path.join(ROOT, entry.output)
  const fromFiles = entry.sources.map(({ file }) => path.basename(file)).join(', ')
  const lines = [
    `// Generated by scripts/function-sources.js from ${fromFiles}. Do not edit:`,
    '// `node scripts/function-sources.js` rewrites it, and its drift test fails until it is current.',
    '/* tslint:disable */',
    '/* eslint-disable */',
    `export const ${entry.exportName} = {`,
  ]
  for (const [name, text] of renderSources(entry)) {
    lines.push(`  ${name}: ${JSON.stringify(text)},`)
  }
  lines.push('}', '')
  return prettier.format(lines.join('\n'), {
    ...prettier.resolveConfig.sync(absolute),
    filepath: absolute,
  })
}

function main() {
  const check = process.argv.includes('--check')
  let stale = 0
  for (const entry of MANIFEST) {
    const absolute = path.join(ROOT, entry.output)
    const next = renderModule(entry)
    const current = fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null
    if (current === next) {
      continue
    }
    stale += 1
    if (check) {
      console.error(`stale: ${entry.output}`)
      continue
    }
    fs.writeFileSync(absolute, next)
    console.log(`wrote ${entry.output}`)
  }
  if (check && stale > 0) {
    process.exit(1)
  }
}

module.exports = { MANIFEST, renderSources, renderModule }

if (require.main === module) {
  main()
}
