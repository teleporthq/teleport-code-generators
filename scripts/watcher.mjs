import chokidar from 'chokidar'
import chalk from 'chalk'
import { exec } from 'child_process'

const log = console.log

const watcher = chokidar.watch(['packages/**/src/**/*.ts', 'packages/**/src/**/*.json'], {
  depth: 4,
  persistent: true,
  usePolling: true,
  interval: 500,
})

log(chalk.yellow.bold('Watching all files... 👀'))

watcher.on('change', async (filePath) => {
  exec(`yarn build`, {}, (err, stdout, stderr) => {
    if (!err || err === null) {
      log(stdout)
    } else {
      log(err, stdout, stderr)
    }
  })
})
