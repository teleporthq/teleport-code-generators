const chokidar  = require('chokidar')
const { exec } = require('child_process')
const chalk = require('chalk')
const log = console.log

const watcher = chokidar.watch('packages/**/src/*.ts', { 
  persistent: true ,
  usePolling: true,
  interval: 500
})

log(chalk.yellow.bold('Watching all files... 👀'))

watcher.on('change', filePath => {
  log(chalk.redBright.bold(`${filePath} is changed`))

  const path = filePath.split('/')
  const location = `${path[0]}/${path[1]}/`

  exec(`tsc`, { cwd: location}, (err, stdout) => {
    if (!err ||  err === null) {
      log(chalk.greenBright(`Package ${path[1]} is re-built`))
    } else {
      log(chalk.white(err))
      log(chalk.white(stdout))
    }
  })
})