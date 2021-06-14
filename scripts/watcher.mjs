import chokidar from 'chokidar'
import chalk from 'chalk'
import { exec } from 'child_process'
import { join } from 'path'
import { buildPackage } from './build.mjs'

const log = console.log

const ignorePackages = ['teleport-repl-component', 'teleport-test']
const watcher = chokidar.watch(['packages/**/src/**/*.ts', 'packages/**/src/**/*.json'], {
  depth: 4,
  persistent: true,
  usePolling: true,
  interval: 500,
})

log(chalk.yellow.bold('Watching all files... 👀'))

watcher.on('change', async (filePath) => {
  const splitPath = filePath.split('/')
  const location = `${splitPath[0]}/${splitPath[1]}/`
  const fileName = splitPath[1]

  if (ignorePackages.includes(fileName)) {
    return
  }

  log(chalk.yellow(`Changes detected in ${fileName}`))
  await buildPackage(join(process.cwd(), `packages/${fileName}`), fileName)

  exec(`yarn types`, { cwd: location }, (err, stdout, stderr) => {
    if (!err || err === null) {
      log(chalk.greenBright(`${splitPath[1]}'s types was successfully re-built`))
    } else {
      log(err, stdout, stderr)
    }
  })
})
