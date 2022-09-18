import {
  FileType,
  GeneratedFile,
  ProjectPlugin,
  ProjectPluginStructure,
} from '@teleporthq/teleport-types'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import { load } from 'cheerio'

class ProjectPluginCloneGlobals implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { files, uidl } = structure
    const entryFile = files.get('entry')?.files[0]
    if (!entryFile) {
      return structure
    }

    const parsedEntry = (await import('cheerio').then((mod) => mod.load))(entryFile.content)
    const scriptTags = parsedEntry('script')

    if (Object.values(uidl.root?.styleSetDefinitions || {}).length > 0) {
      parsedEntry('head').append(`<link rel="stylesheet" href="./style.css"></link>`)
    }

    files.forEach((fileId, key) => {
      const { path } = fileId

      if (path[0] === '') {
        const newFiles: GeneratedFile[] = fileId.files.map((file) => {
          if (file.fileType === FileType.HTML) {
            parsedEntry('body').empty()
            parsedEntry('meta').remove()
            parsedEntry('title').remove()
            const parsedIndividualFile = load(file.content)

            const metaTags = parsedIndividualFile.root().find('meta')
            parsedEntry('head').append(metaTags.toString())
            parsedIndividualFile('meta').remove()

            const titleTags = parsedIndividualFile.root().find('title')
            parsedEntry('head').append(titleTags.toString())
            parsedIndividualFile('title').remove()

            parsedEntry('body').append(scriptTags.toString())
            parsedEntry('body').append(parsedIndividualFile.html())

            const prettyFile = prettierHTML({
              [FileType.HTML]: parsedEntry.html(),
            })
            const resultFile = {
              name: file.name,
              content: prettyFile[FileType.HTML],
              fileType: FileType.HTML,
            }
            return resultFile
          }
          return file
        })
        files.set(key, { path, files: newFiles })
      }
    })

    files.delete('entry')
    return structure
  }
}

export const pluginCloneGlobals = Object.freeze(new ProjectPluginCloneGlobals())
