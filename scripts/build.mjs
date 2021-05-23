import chalk from 'chalk'
import { build } from 'esbuild'
import { existsSync, copyFileSync } from 'fs'
import { extname } from 'path'
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

  if (!isEntryExists) {
    throw new Error(`Entry file missing from ${packageName}`)
  }

  await build({
    entryPoints: [`${path}/src/index.ts`],
    outdir: `${path}/dist/cjs`,
    format: 'cjs',
    target: 'es6',
  }).catch((e) => {
    throw new Error(`Build failed for ${packageName} \n ${e}`)
  })

  await build({
    entryPoints: [`${path}/src/index.ts`],
    outdir: `${path}/dist/esm`,
    format: 'esm',
    target: 'es6',
  }).catch((e) => {
    throw new Error(`Build failed for ${packageName} \n ${e}`)
  })

  const filesToCopy = []
  walk(`${path}/src`, { sync: true }, (subPath) => {
    const fileType = extname(subPath)
    if (fileType === '.json') {
      filesToCopy.push(subPath)
    }
  })
  filesToCopy.map((filePath) => {
    copyFileSync(filePath, filePath.replace('src', 'dist/cjs'))
    copyFileSync(filePath, filePath.replace('src', 'dist/esm'))
  })

  console.log(chalk.green(`${packageName}`))
}
