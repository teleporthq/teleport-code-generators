import { GeneratedFolder } from '@teleporthq/teleport-types'
import { parse } from 'path'

export const pack = (files: Record<string, { code: string }>) => {
  if (!Object.keys(files).length) {
    return null
  }

  const project = Object.keys({ ...files }).reduce(
    (acc: GeneratedFolder, current) => {
      const folderPath = current.split('/').filter((e) => e)
      folderPath.shift()
      let subFolder = acc
      folderPath.forEach((folderName, index) => {
        const parsedFolderName = parse(folderName)

        if (parsedFolderName.ext) {
          const nameWithoutExt = parsedFolderName.name

          if (index === folderPath.length - 1) {
            const currentFile = files?.[current]
            const fileType = parsedFolderName.ext.substring(1)
            subFolder.files.push({
              content: currentFile?.code,
              fileType,
              name: nameWithoutExt,
            })
            return
          }
        }

        const existingSubFolder = subFolder.subFolders.find((el) => el.name === folderName)
        if (!existingSubFolder) {
          const newSubFolder = {
            name: folderName,
            files: [],
            subFolders: [],
          } as GeneratedFolder
          subFolder.subFolders.push(newSubFolder)
          subFolder.subFolders.sort((a, b) => a.name.localeCompare(b.name))

          subFolder = newSubFolder
        } else {
          subFolder = existingSubFolder
        }
      })

      return acc
    },
    { name: 'teleport-project-react', subFolders: [], files: [] } as GeneratedFolder
  )

  return project as GeneratedFolder
}
