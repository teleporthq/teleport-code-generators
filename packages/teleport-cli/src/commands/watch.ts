import ora from 'ora'
import { findFileByName } from '../services/file'
import { CONFIG_FILE } from '../constants'
import { extractCompIdsFromURls } from '../utils'

/* Watch takes a set of components defined and tried to observe for changes.
And loads then on request */

export default async function () {
  const content = JSON.parse(findFileByName(CONFIG_FILE))
  const { components = [] } = content || {}
  if (components.length === 0) {
    return
  }
  const compIds = extractCompIdsFromURls(components)
  const spinner = ora(`Watching components \n ${JSON.stringify(compIds)}`)
  spinner.start()
  setTimeout(() => {
    spinner.stop()
  }, 1000)
}
