import chalk from 'chalk'
import { writeFileSync } from 'fs-extra'
import path from 'path'
import { LOCK_FILE_NAME, LOCK_FILE_TEMPLATE } from '../constants'
import { findFileByName } from '../services/file'

export default function () {
  const isFileExists = findFileByName(LOCK_FILE_NAME)
  if (!isFileExists) {
    writeFileSync(
      path.join(process.cwd(), LOCK_FILE_NAME),
      JSON.stringify(LOCK_FILE_TEMPLATE, null, 2)
    )
    return
  }
  console.warn(chalk.yellow(`${LOCK_FILE_NAME} already exists`))
}
