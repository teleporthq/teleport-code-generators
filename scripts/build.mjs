import chalk from 'chalk'
import { build } from 'esbuild'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import walk from 'walkdir'

const ignorePackages = ['teleport-repl-component', 'teleport-test']
const emitter = walk('packages', {
  max_depth: 1,
})

emitter.on('directory', async (path) => {
  const split = path.split('/')
  const packageName = split[split.length - 1]
  if (ignorePackages.includes(packageName)) {
    return
  }

  await buildPackage(path, packageName)
})
emitter.on('error', (err) => console.log(err))

export const buildPackage = async (path, packageName) => {
  const entry = `${path}/src/index.ts`
  const isEntryExists = existsSync(entry)
  let packageJSON
  try {
    packageJSON = readFileSync(join(process.cwd(), `packages/${packageName}/package.json`), 'utf-8')
  } catch (e) {
    return
  }

  if (!isEntryExists || !packageJSON) {
    throw new Error(`Entry file missing from ${packageName}`)
  }

  const external = [...Object.keys(JSON.parse(packageJSON)?.dependencies || {})]
  external.push('path')
  external.push('fs')

  const input = `${path}/src/index.ts`
  const cjsOutput = `${path}/dist/cjs`

  await build({
    entryPoints: [input],
    outdir: cjsOutput,
    format: 'cjs',
    target: 'es6',
    bundle: true,
    minify: false,
    external,
  }).catch((e) => {
    reject(`Build failed for ${packageName} \n ${e}`)
  })

  await build({
    entryPoints: [`${path}/src/index.ts`],
    outdir: `${path}/dist/esm`,
    format: 'esm',
    target: 'es6',
    bundle: true,
    minify: false,
    external,
  }).catch((e) => {
    reject(`Build failed for ${packageName} \n ${e}`)
  })

  console.log(chalk.green(`${packageName}`))
}
