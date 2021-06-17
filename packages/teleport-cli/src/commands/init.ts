import chalk from 'chalk'
import { writeFileSync } from 'fs-extra'
import path from 'path'
import { DEFAULT_CONFIG_FILE_NAME, DEFALT_CONFIG_TEMPLATE } from '../constants'
import { findFileByName } from '../services/file'

export default function () {
  const isFileExists = findFileByName(DEFAULT_CONFIG_FILE_NAME)
  if (!isFileExists) {
    writeFileSync(
      path.join(process.cwd(), DEFAULT_CONFIG_FILE_NAME),
      JSON.stringify(DEFALT_CONFIG_TEMPLATE, null, 2)
    )
    return
  }
  console.warn(chalk.yellow(`${DEFAULT_CONFIG_FILE_NAME} already exists`))
}
