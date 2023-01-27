import chalk from 'chalk'
import { writeFileSync } from 'fs-extra'
import path from 'path'
import { CONFIG_FILE, LOCK_FILE_TEMPLATE } from '../constants'
import { findFileByName } from '../services/file'

export default function () {
  const isFileExists = findFileByName(CONFIG_FILE)
  if (!isFileExists) {
    writeFileSync(
      path.join(process.cwd(), CONFIG_FILE),
      JSON.stringify(LOCK_FILE_TEMPLATE, null, 2)
    )
    return
  }
  console.warn(chalk.yellow(`${CONFIG_FILE} already exists`))
}
