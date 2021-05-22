import chokidar from 'chokidar'
import chalk from 'chalk'
import { join } from 'path'
import { buildPackage } from './build.mjs'

const log = console.log

const ignorePackages = ['teleport-repl-component', 'teleport-test']
const watcher = chokidar.watch(['packages/**/src/**/*.ts', 'packages/**/src/**/*.json'], {
  depth: 3,
  persistent: true,
  usePolling: true,
  interval: 500,
})

log(chalk.yellow.bold('Watching all files... 👀'))

watcher.on('change', async (filePath) => {
  const splitPath = filePath.split('/')
  const fileName = splitPath[1]

  if (ignorePackages.includes(fileName)) {
    return
  }

  console.log(fileName)
  log(chalk.yellow(`Changes detected in ${fileName}`))
  await buildPackage(join(process.cwd(), `packages/${fileName}`), fileName)
})
