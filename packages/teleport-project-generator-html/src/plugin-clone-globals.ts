import {
  FileType,
  GeneratedFile,
  ProjectPlugin,
  ProjectPluginStructure,
} from '@teleporthq/teleport-types'
import { parse, HTMLElement } from 'node-html-parser'
import prettierHTML from '@teleporthq/teleport-postprocessor-prettier-html'

class ProjectPluginCloneGlobals implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { files, uidl } = structure
    const entryFile = files.get('entry')
    if (!entryFile) {
      return structure
    }

    const result = parse(entryFile.files[0].content)
    const body = result.querySelector('body')
    body.childNodes = []

    if (Object.values(uidl.root?.styleSetDefinitions || {}).length > 0) {
      const head = result.querySelector('head')
      head.appendChild(new HTMLElement('link', {}, 'rel="stylesheet" href="./style.css"', result))
    }

    files.forEach((fileId, key) => {
      const { path } = fileId
      if (path[0] === '') {
        const newFiles: GeneratedFile[] = fileId.files.map((file) => {
          if (file.fileType === FileType.HTML) {
            body.innerHTML = file.content
            const prettyFile = prettierHTML({
              [FileType.HTML]: result.toString(),
            })

            return { name: file.name, content: prettyFile[FileType.HTML], fileType: FileType.HTML }
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
