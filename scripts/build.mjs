import chalk from 'chalk'
import { build } from 'esbuild'
import { NodeModulesPolyfillPlugin } from '@esbuild-plugins/node-modules-polyfill'
import walk from 'walkdir'

const log = console.log

const ignorePackages = ['teleport-repl-component', 'teleport-test']
const total = []

const emitter = walk('packages', {
  max_depth: 1,
})

emitter.on('directory', async (path) => {
  const split = path.split('/')
  const packageName = split[split.length - 1]
  if (ignorePackages.includes(packageName)) {
    return
  }

  log(chalk.gray(`Building ${packageName}`))
  await buildPackage(path, packageName)
  log(chalk.green(`Building completed - ${packageName}`))
})

emitter.on('error', (err) => console.log(err))

const buildPackage = async (path, packageName) => {
  await build({
    entryPoints: [`${path}/src/index.ts`],
    outdir: `${path}/dist/cjs`,
    format: 'cjs',
    plugins: [new NodeModulesPolyfillPlugin()],
  }).catch((e) => {
    throw new Error(`${packageName} \n ${e}`)
  })
}
