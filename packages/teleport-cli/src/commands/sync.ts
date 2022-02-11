import chalk from 'chalk'
import { DefaultConfigTemplate, LOCKFILE } from '../constants'
import { findFileByName } from '../services/file'
import clone from './clone'

/* By default sync only components specified ? */
export default async function sync({ force }: { force: boolean }) {
  const config = findFileByName(LOCKFILE)
  if (!config) {
    console.warn(chalk.yellow(`${LOCKFILE} is missing from project.`))
  }

  const { components = {}, project } = JSON.parse(config) as DefaultConfigTemplate

  if (project?.url) {
    clone({ url: project.url, targetPath: '../', force })
  }

  Object.values(components).forEach((comp) => {
    const { url, path: targetPath } = comp
    clone({ url, targetPath, force })
  })
}
