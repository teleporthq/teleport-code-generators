import chalk from 'chalk'
import { DefaultConfigTemplate, CONFIG_FILE } from '../constants'
import { findFileByName } from '../services/file'
import clone from './clone'

/* By default sync only components specified ? */
export default async function sync({ force }: { force: boolean }) {
  const config = findFileByName(CONFIG_FILE)
  if (!config) {
    console.warn(chalk.yellow(`${CONFIG_FILE} is missing from project.`))
  }

  const { components = {}, project } = JSON.parse(config) as DefaultConfigTemplate

  if (project?.url) {
    clone({ url: project.url, targetPath: '../', force })
  }

  Object.keys(components).forEach((comp) => {
    const { path: targetPath } = components[comp]
    clone({ url: comp, targetPath, force })
  })
}
