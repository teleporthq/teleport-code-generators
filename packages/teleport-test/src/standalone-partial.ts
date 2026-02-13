// @ts-nocheck
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { performance } from 'perf_hooks'
import {
  createNextPartialGenerator,
  splitProjectUIDL,
} from '@teleporthq/teleport-project-generator-next'
import projectJSON from '../../../examples/uidl-samples/project.json'

const OUTPUT_DIR = join(__dirname, '..', 'dist', 'teleport-project-next-partial-results')

const ensureDir = (dir: string) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/** Write a generated file to a path inside a base dir */
const writeFile = (
  baseDir: string,
  relativePath: string,
  file: { name: string; fileType: string; content: string }
) => {
  const dir = join(baseDir, relativePath)
  ensureDir(dir)
  const ext = file.fileType ? `.${file.fileType}` : ''
  writeFileSync(join(dir, `${file.name}${ext}`), file.content, 'utf-8')
}

const logStep = (label: string, t1: number) => {
  const elapsed = performance.now() - t1
  console.info(chalk.greenBright(`  ${label} — ${elapsed.toFixed(2)}ms`))
}

const run = async () => {
  const t0 = performance.now()
  console.info(chalk.bold('\nNext.js Partial Generator — Standalone Test'))
  console.info(chalk.gray('Source: examples/uidl-samples/project.json\n'))

  // Clean previous output
  if (existsSync(OUTPUT_DIR)) {
    rmSync(OUTPUT_DIR, { recursive: true })
  }

  // ---- Step 1: Split the project UIDL ----
  let t1 = performance.now()
  const split = splitProjectUIDL(projectJSON as Record<string, unknown>)
  logStep('splitProjectUIDL', t1)

  console.info(
    chalk.gray(
      `  → ${split.pages.length} pages, ${Object.keys(split.components).length} components`
    )
  )

  // ---- Step 2: Create the partial generator with shared options ----
  const partial = createNextPartialGenerator(split.sharedOptions)

  // Collect all dependencies across all generation steps
  const allDependencies: Record<string, string> = {}
  const mergeDeps = (deps: Record<string, string>) => {
    Object.assign(allDependencies, deps)
  }

  // ---- Step 3: Generate each piece individually ----
  // Each generator writes to its own folder under OUTPUT_DIR

  // 3a. Pages — each page gets its own folder: generate-page/{pageName}/
  console.info(chalk.cyan('\nPages:'))
  for (const pageUIDL of split.pages) {
    t1 = performance.now()
    const result = await partial.generatePage(pageUIDL)
    const folderPath = pageUIDL.outputOptions?.folderPath || []
    const pageName = pageUIDL.outputOptions?.fileName || pageUIDL.name
    const pageLabel = [...folderPath, pageName].join('/')
    const pageOutputDir = join(OUTPUT_DIR, 'generate-page', pageLabel)
    logStep(`generate-page/${pageLabel}`, t1)

    // Main page files go into pages/{folderPath}/
    const pageDir = ['pages', ...folderPath].join('/')
    result.files.forEach((file) => writeFile(pageOutputDir, pageDir, file))
    mergeDeps(result.dependencies)

    // Extracted resources (data source handlers) go into their actual paths
    if (result.extractedResources && Object.keys(result.extractedResources).length > 0) {
      Object.entries(result.extractedResources).forEach(([, res]) => {
        const resDir = (res.path || []).join('/')
        writeFile(pageOutputDir, resDir, {
          name: res.fileName,
          fileType: res.fileType,
          content: res.content,
        })
      })
    }
  }

  // 3b. Components — each component gets its own folder: generate-component/{compName}/
  console.info(chalk.cyan('\nComponents:'))
  for (const [componentKey, componentUIDL] of Object.entries(split.components)) {
    t1 = performance.now()
    const result = await partial.generateComponent(componentUIDL)
    const compName = componentUIDL.outputOptions?.fileName || componentKey
    const compOutputDir = join(OUTPUT_DIR, 'generate-component', compName)
    logStep(`generate-component/${compName}`, t1)

    result.files.forEach((file) => writeFile(compOutputDir, 'components', file))
    mergeDeps(result.dependencies)

    // Extracted resources (data source handlers, API routes)
    if (result.extractedResources && Object.keys(result.extractedResources).length > 0) {
      Object.entries(result.extractedResources).forEach(([, res]) => {
        const resDir = (res.path || []).join('/')
        writeFile(compOutputDir, resDir, {
          name: res.fileName,
          fileType: res.fileType,
          content: res.content,
        })
      })
    }
  }

  // 3c. Global stylesheet: generate-stylesheet/
  console.info(chalk.cyan('\nStylesheet:'))
  t1 = performance.now()
  const stylesheetResult = await partial.generateStyleSheet(split.rootUIDL)
  const stylesheetOutputDir = join(OUTPUT_DIR, 'generate-stylesheet')
  logStep('generate-stylesheet', t1)
  stylesheetResult.files.forEach((file) => writeFile(stylesheetOutputDir, 'pages', file))
  mergeDeps(stylesheetResult.dependencies)

  // 3d. Entry file (_document.js): generate-entry-file/
  console.info(chalk.cyan('\nEntry file:'))
  t1 = performance.now()
  const entryResult = partial.generateEntryFile(split.projectUIDL)
  const entryOutputDir = join(OUTPUT_DIR, 'generate-entry-file')
  logStep('generate-entry-file', t1)
  entryResult.files.forEach((file) => writeFile(entryOutputDir, 'pages', file))

  // 3e. Framework config (_app.js): generate-framework-config/
  console.info(chalk.cyan('\nFramework config:'))
  t1 = performance.now()
  const hasI18n =
    split.projectUIDL.internationalization &&
    Object.keys(split.projectUIDL.internationalization.languages || {}).length > 0
  const configResult = partial.generateFrameworkConfig({
    dependencies: hasI18n ? { 'next-intl': '^2.0.0' } : {},
    globalStyles: {
      path: './',
      sheetName: 'style',
      isGlobalStylesDependent: true,
    },
  })
  const configOutputDir = join(OUTPUT_DIR, 'generate-framework-config')
  logStep('generate-framework-config', t1)
  configResult.files.forEach((file) => writeFile(configOutputDir, 'pages', file))
  mergeDeps(configResult.dependencies)

  // 3f. Resources — each resource gets its own folder: generate-resource/{resourceKey}/
  const resourceItems = split.resources.items
  if (resourceItems && Object.keys(resourceItems).length > 0) {
    console.info(chalk.cyan('\nResources:'))
    for (const [resourceKey, resourceItem] of Object.entries(resourceItems)) {
      t1 = performance.now()
      const result = await partial.generateResource(resourceItem, split.resources.mappers)
      const resOutputDir = join(OUTPUT_DIR, 'generate-resource', resourceKey)
      logStep(`generate-resource/${resourceKey}`, t1)
      result.files.forEach((file) => writeFile(resOutputDir, 'resources', file))
      mergeDeps(result.dependencies)
    }
  }

  // 3g. Env files: generate-env-files/
  if (split.env && Object.keys(split.env).length > 0) {
    console.info(chalk.cyan('\nEnv files:'))
    t1 = performance.now()
    const envResult = partial.generateEnvFiles(split.env)
    const envOutputDir = join(OUTPUT_DIR, 'generate-env-files')
    logStep('generate-env-files', t1)
    envResult.files.forEach((file) => writeFile(envOutputDir, '', file))
  }

  // 3h. Manifest: generate-manifest/
  console.info(chalk.cyan('\nManifest:'))
  t1 = performance.now()
  const manifestResult = partial.generateManifest(split.projectUIDL)
  const manifestOutputDir = join(OUTPUT_DIR, 'generate-manifest')
  logStep('generate-manifest', t1)
  if (manifestResult.files.length > 0) {
    manifestResult.files.forEach((file) => writeFile(manifestOutputDir, 'public', file))
  } else {
    console.info(chalk.gray('  → No manifest defined in project UIDL'))
  }

  // 3i. Global context: generate-global-context/
  console.info(chalk.cyan('\nGlobal context:'))
  t1 = performance.now()
  const globalContextResult = partial.generateGlobalContext(split.projectUIDL.internationalization)
  const gcOutputDir = join(OUTPUT_DIR, 'generate-global-context')
  logStep('generate-global-context', t1)
  globalContextResult.files.forEach((file) => writeFile(gcOutputDir, '', file))

  // 3j. Locale files: generate-locale-files/
  if (split.projectUIDL.internationalization?.translations) {
    console.info(chalk.cyan('\nLocale files:'))
    t1 = performance.now()
    const localeResult = await partial.generateLocaleFiles(split.projectUIDL.internationalization)
    const localeOutputDir = join(OUTPUT_DIR, 'generate-locale-files')
    logStep(`generate-locale-files (${localeResult.files.length} files)`, t1)
    localeResult.files.forEach((file) => writeFile(localeOutputDir, 'locales', file))
  }

  // 3k. Next config: generate-next-config/
  console.info(chalk.cyan('\nNext config:'))
  t1 = performance.now()
  const nextConfigResult = partial.generateNextConfig(split.projectUIDL.internationalization)
  const nextConfigOutputDir = join(OUTPUT_DIR, 'generate-next-config')
  logStep('generate-next-config', t1)
  nextConfigResult.files.forEach((file) => writeFile(nextConfigOutputDir, '', file))

  // 3l. Data source dependencies (no file output, just dependency resolution)
  if (split.dataSources && Object.keys(split.dataSources).length > 0) {
    console.info(chalk.cyan('\nData source dependencies:'))
    t1 = performance.now()
    const dsDeps = partial.resolveDataSourceDependencies(split.dataSources)
    logStep('resolve-data-source-deps', t1)
    mergeDeps(dsDeps)
  }

  // 3m. External CSS imports (no file output, generates import statements for _app.js)
  const cssImports = split.projectUIDL.root.importDefinitions || {}
  const cssImportDeps = Object.entries(cssImports).reduce(
    (acc: Record<string, any>, [key, dep]) => {
      if (dep.path.endsWith('.css')) {
        acc[key] = dep
      }
      return acc
    },
    {}
  )
  if (Object.keys(cssImportDeps).length > 0) {
    console.info(chalk.cyan('\nExternal CSS imports:'))
    t1 = performance.now()
    partial.generateExternalCSSImports(cssImportDeps)
    logStep('external-css-imports', t1)
  }

  // Write collected dependencies summary
  const depsOutputDir = join(OUTPUT_DIR, '_collected-dependencies')
  ensureDir(depsOutputDir)
  const packageJson = {
    name: split.projectUIDL.name,
    dependencies: allDependencies,
  }
  writeFileSync(join(depsOutputDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf-8')

  // ---- Summary ----
  const totalTime = performance.now() - t0
  console.info(chalk.bold.greenBright(`\nDone in ${totalTime.toFixed(2)}ms`))
  console.info(chalk.gray(`Output: ${OUTPUT_DIR}\n`))
}

run().catch((err) => {
  // tslint:disable-next-line:no-console
  console.error(chalk.red('Error running partial generator standalone test:'))
  // tslint:disable-next-line:no-console
  console.error(err)
  process.exit(1)
})
