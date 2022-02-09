// @ts-nocheck
import { ProjectType, VComponentUIDL, VProjectUIDL } from '@teleporthq/teleport-types'
import {
  fetchSnapshot,
  fetchUIDLFromREPL,
  generateComponentFromUIDL,
  generateProjectFromUIDL,
} from '../services/code'
import { injectFilesToPath } from '../services/file'
import { HOST_NAME_MAP } from '../constants'
import { getComponentType, updateConfigFile } from '../utils'
import { MapSnapshotToUIDL } from '@teleporthq/teleport-mapper'
import ora from 'ora'

export default async function (options: { url: string; targetPath: string; force?: boolean }) {
  const { url, targetPath, force = false } = options
  const name = 'teleport-project'
  const spinner = ora()
  spinner.start()

  const { host, pathname } = new URL(url)

  if (Object.keys(HOST_NAME_MAP).includes(host)) {
    const opts = pathname.split('/')
    spinner.text = `Fetching from studio ${opts[2]} \n`

    const result = await fetchSnapshot(opts[2], host)
    const {
      name: nameFromSnapshot,
      snapshot: { data },
    } = result

    if (opts.length === 5) {
      try {
        spinner.text = `Fetching from studio ${opts[2]} \n`

        const mapper = new MapSnapshotToUIDL(data)
        const uidl = mapper.pageToUIDL(opts[4])
        if (!uidl) {
          throw new Error('Failed in Generating UIDL')
        }

        nameFromSnapshot ? (uidl.name = nameFromSnapshot) : (uidl.name = name)

        const { files } = await generateComponentFromUIDL(uidl, getComponentType())
        injectFilesToPath({ rootFolder: process.cwd(), targetPath, files, force })
        updateConfigFile((content) => {
          content.components[url] = { url, path: targetPath }
        })

        spinner.text = `Component ${files[0].name}.${files[0].fileType} generated`
        spinner.succeed()
      } catch (e) {
        spinner.text = 'Failed in generating component'
        spinner.fail()
        /* tslint:disable-next-line:no-console */
        console.trace(e)
      }
      return
    }

    try {
      const mapper = new MapSnapshotToUIDL(data)
      const uidl = mapper.toProjectUIDL()
      if (!uidl) {
        throw new Error('Failed in Generating UIDL')
      }

      nameFromSnapshot ? (uidl.name = nameFromSnapshot) : (uidl.name = name)

      const fileName = await generateProjectFromUIDL({
        uidl,
        projectType: ProjectType.REACT,
        targetPath,
        url,
        force,
      })

      updateConfigFile((content) => {
        content.project.name = fileName
      })

      spinner.text = `Project Generated Successfully ${fileName}`
      spinner.succeed()
    } catch (e) {
      spinner.text = `Project Generation Failed`
      spinner.fail()
      /* tslint:disable-next-line:no-console */
      console.trace(e)
    }
  }

  if (host === 'repl.teleporthq.io') {
    /* Generating projects */
    if (url.includes('project')) {
      try {
        spinner.text = `Fetching project from repl \n`

        const uidl = (await fetchUIDLFromREPL(url)) as VProjectUIDL
        const fileName = await generateProjectFromUIDL({
          uidl,
          projectType: ProjectType.NEXT,
          targetPath,
          url,
          force,
        })

        updateConfigFile((content) => {
          content.project.name = fileName
        })
        spinner.text = `Project Generated Successfully ${fileName}`
        spinner.succeed()
      } catch (e) {
        spinner.text = `Project Generation Failed`
        spinner.fail()
        console.warn(e)
      }
    } else {
      try {
        spinner.text = `Fetching component from repl \n`

        const uidl = (await fetchUIDLFromREPL(url)) as VComponentUIDL
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
