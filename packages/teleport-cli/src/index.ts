#! /usr/bin/env node

import program from 'commander'
import chalk from 'chalk'
import minimist from 'minimist'
import clone from './commands/clone'
import watch from './commands/watch'
import format from './commands/format'
import sync from './commands/sync'
import init from './commands/init'
import packageJSON from '../package.json'
import { CONFIG_FILE } from './constants'

program.version(`v${packageJSON.version}`)

program.command('init').description(`Creates a ${CONFIG_FILE}`).action(init)

program
  .command('sync')
  .description(`Sync's all the components defined in ${CONFIG_FILE}`)
  .option('-f --force')
  .action(() => {
    const flags = minimist(process.argv.slice(2))
    sync({ force: Boolean(flags?.f || flags?.force) })
  })

program
  .command('format')
  .description(
    'Formats any file when a path is provided. Uses format options already set by @teleporthq'
  )
  .option('-p --path <path-url>')
  .action(() => {
    const flags = minimist(process.argv.slice(2))
    const targetPath = (flags?.p || flags?.path) ?? '/'
    format({ targetPath })
  })

program
  .command('watch')
  .description('Watch for a set of components in Studio and generate them in local')
  .option('-p --path <path-url>')
  .action(watch)

program
  .command('clone')
  .description('Pull a component from REPL / Studio')
  .option('-l --link')
  .option('-p --path <path-url>')
  .action(() => {
    const flags = minimist(process.argv.slice(2))
    if (Object.keys(flags).length === 0) {
      console.warn(chalk.yellow(`Link missing, please check --link`))
    }
    if (flags?.l || flags?.link) {
      clone({
        url: flags?.l || flags?.link,
        targetPath: flags?.p || flags?.path || '/',
      })
    }
  })

program.parse(process.argv)
