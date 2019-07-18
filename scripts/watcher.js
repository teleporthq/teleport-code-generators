const chokidar  = require('chokidar')
const { exec } = require('child_process')
const chalk = require('chalk')
const log = console.log

const ignorePackages = [
  'teleport-repl-component',
  'teleport-project-packer-test'
]

log(chalk.greenBright('Building all packges, please wait for a moment...'))

exec('lerna run build', (err, stdout, stderr) => {
  if (!err || err === null) {
    createWatcher()
  } else {
    displayError(err, stdout, stderr)
  }
})

createWatcher = () => {
  const watcher = chokidar.watch('packages/**/src/*.ts', { 
    persistent: true ,
    usePolling: true,
    interval: 500
  })
  
  log(chalk.yellow.bold('Watching all files... 👀'))
  
  watcher.on('change', filePath => {
    const path = filePath.split('/')
    const location = `${path[0]}/${path[1]}/`
    
    if (!ignorePackages.includes(path[1])) {
      log(chalk.redBright.bold(`${filePath} is changed`))
      exec(`tsc`, { cwd: location}, (err, stdout, stderr) => {
        if (!err ||  err === null) {
          log(chalk.greenBright(`Package ${path[1]} is re-built`))
        } else {
          displayError(err, stdout, stderr)
        }
      })
    }
  })
}

displayError = (err, stdout, stderr) => {
  log(chalk.white(err))
  log(chalk.white(stdout))
  log(chalk.white(stderr))
}