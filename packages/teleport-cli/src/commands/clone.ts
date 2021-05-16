import { ProjectType, VComponentUIDL, VProjectUIDL } from '@teleporthq/teleport-types'
import {
  fetchSnapshotFromPlayground,
  fetchUIDLFromREPL,
  generateComponentFromUIDL,
  generateProjectFromUIDL,
} from '../services'
import { injectFilesToPath } from '../services/file'
import { getComponentType, updateConfigFile } from '../utils'
import { MapSnapshotToUIDL } from '@teleporthq/teleport-mapper'
import ora from 'ora'

export default async function (options: { url: string; targetPath: string; force?: boolean }) {
  const { url, targetPath, force = false } = options
  let uidl: VComponentUIDL | VProjectUIDL
  const spinner = ora()
  spinner.start()
  if (url.includes('play.teleporthq.io') && !url.includes('repl.teleporthq.io')) {
    const opts = url.split('/')

    if (opts.length === 5) {
      try {
        spinner.text = `Fetching from studio ${opts[4]} \n`
        const {
          snapshot: { data },
        } = await fetchSnapshotFromPlayground(opts[4])

        const mapper = new MapSnapshotToUIDL(data)
        uidl = mapper.toProjectUIDL()

        if (!uidl) {
          throw new Error('Failed in Generating UIDL')
        }

        const projectName = await generateProjectFromUIDL({
          uidl,
          projectType: ProjectType.NEXT,
          targetPath,
          url,
          force,
        })

        if (projectName) {
          updateConfigFile((content) => {
            content.project.name = projectName
          })
          spinner.text = `Project Generated Successfully ${projectName}`
          spinner.succeed()
        } else {
          throw new Error()
        }
      } catch (e) {
        spinner.text = `Project Generation Failed`
        spinner.fail()
        console.warn(e)
      }
    }

    if (opts.length >= 7) {
      try {
        spinner.text = `Fetching from studio ${opts[4]} \n`

        const {
          snapshot: { data },
        } = await fetchSnapshotFromPlayground(opts[4])

        const mapper = new MapSnapshotToUIDL(data)
        uidl = mapper.pageToUIDL(opts[6])

        if (!uidl) {
          throw new Error('Failed in Generating UIDL')
        }

        const { files } = await generateComponentFromUIDL(uidl, getComponentType())
        injectFilesToPath({ rootFolder: process.cwd(), targetPath, files, force })
        updateConfigFile((content) => {
          content.components[url] = { url, path: targetPath }
        })

        spinner.text = `Component ${files[0].name}.${files[0].fileType} generated`
        spinner.succeed()
      } catch (e) {
        spinner.text = 'Failed in generating project'
        spinner.fail()
        console.warn(e)
      }
    }
  }

  if (url.includes('repl.teleporthq.io')) {
    /* Generating projects */
    if (url.includes('project')) {
      try {
        spinner.text = `Fetching project from repl \n`

        uidl = (await fetchUIDLFromREPL(url)) as VProjectUIDL
        const projectName = await generateProjectFromUIDL({
          uidl,
          projectType: ProjectType.NEXT,
          targetPath,
          url,
          force,
        })

        if (projectName) {
          updateConfigFile((content) => {
            content.project.name = projectName
          })
          spinner.text = `Project Generated Successfully ${projectName}`
          spinner.succeed()
        } else {
          throw new Error()
        }
      } catch (e) {
        spinner.text = `Project Generation Failed`
        spinner.fail()
        console.warn(e)
      }
    } else {
      try {
        spinner.text = `Fetching component from repl \n`

        uidl = (await fetchUIDLFromREPL(url)) as VComponentUIDL
        const { files } = await generateComponentFromUIDL(uidl, getComponentType())

        injectFilesToPath({
          rootFolder: process.cwd(),
          targetPath,
          files,
          force,
        })
        updateConfigFile((content) => {
          content.components[url] = { url, path: targetPath }
        })

        spinner.text = `Component ${files[0].name}.${files[0].fileType} generated`
        spinner.succeed()
      } catch (e) {
        spinner.text = `Component Generation Failed`
        spinner.fail()
        console.warn(e)
      }
    }
  }
  spinner.stop()
}
