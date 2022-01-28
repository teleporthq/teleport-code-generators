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

    const parsedEntryFile = parse(entryFile.files[0].content)
    const body = parsedEntryFile.querySelector('body')
    const head = parsedEntryFile.querySelector('head')
    /* script tags are injected using customCode field of UIDL */
    const scriptTags = body.querySelectorAll('script')

    body.childNodes = []

    if (Object.values(uidl.root?.styleSetDefinitions || {}).length > 0) {
      head.appendChild(
        new HTMLElement('link', {}, 'rel="stylesheet" href="./style.css"', parsedEntryFile)
      )
    }

    files.forEach((fileId, key) => {
      const { path } = fileId
      if (path[0] === '') {
        const newFiles: GeneratedFile[] = fileId.files.map((file) => {
          if (file.fileType === FileType.HTML) {
            const parsedIndividualFile = parse(file.content)
            const metaTags = parsedIndividualFile.getElementsByTagName('meta')
            const titleTags = parsedIndividualFile.getElementsByTagName('title')

            metaTags.forEach((metaTag) => {
              head.childNodes.unshift(metaTag)
              metaTag.remove()
            })
            titleTags.forEach((titleTag) => {
              const inheritedHeadTags = head.getElementsByTagName('title')
              if (inheritedHeadTags.length > 0) {
                head.removeChild(head.getElementsByTagName('title')[0])
              }
              head.childNodes.unshift(titleTag)
              titleTag.remove()
            })

            body.innerHTML = parsedIndividualFile.toString()
            body.childNodes.push(...scriptTags)

            const prettyFile = prettierHTML({
              [FileType.HTML]: parsedEntryFile.toString(),
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
