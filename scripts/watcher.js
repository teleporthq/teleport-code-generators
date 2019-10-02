const chokidar  = require('chokidar')
const { exec } = require('child_process')
const chalk = require('chalk')
const log = console.log

const ignorePackages = [
  'teleport-repl-component',
  'teleport-test'
]

const watcher = chokidar.watch(['packages/**/src/**/*.ts', 'packages/**/src/**/*.json'], { 
  persistent: true ,
  usePolling: true,
  interval: 500
})

log(chalk.yellow.bold('Watching all files... 👀'))

watcher.on('change', filePath => {
  const path = filePath.split('/')
  const location = `${path[0]}/${path[1]}/`
  
  if (!ignorePackages.includes(path[1])) {
    log(chalk.yellow(`Changes detected in ${filePath}`))
    exec(`yarn build`, { cwd: location}, (err, stdout, stderr) => {
      if (!err ||  err === null) {
        log(chalk.greenBright(`Package ${path[1]} was successfully re-built`))
      } else {
        displayError(err, stdout, stderr)
      }
    })
  }
})

displayError = (err, stdout, stderr) => {
  log(chalk.white(err))
  log(chalk.white(stdout))
  log(chalk.white(stderr))
}