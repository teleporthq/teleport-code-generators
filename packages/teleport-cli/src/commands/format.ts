import ora from 'ora'
import path from 'path'
import { readdirSync, writeFileSync, readFileSync, lstatSync } from 'fs-extra'
import { FileType, PostProcessor } from '@teleporthq/teleport-types'
import processorVUE from '@teleporthq/teleport-postprocessor-vue-file'
import processorTS from '@teleporthq/teleport-postprocessor-prettier-ts'
import processorJSX from '@teleporthq/teleport-postprocessor-prettier-jsx'
import processorHTML from '@teleporthq/teleport-postprocessor-prettier-html'
import { IGNORE_EXTENSIONS, IGNORE_FOLDERS } from '../constants'

const processors: Record<string, PostProcessor> = {
  [FileType.JS]: processorJSX,
  [FileType.HTML]: processorHTML,
  [FileType.VUE]: processorVUE,
  [FileType.TS]: processorTS,
}

/* We can extend the prettier config, ignore folders, ignore extensions */
const format = async ({ targetPath }: { targetPath: string }) => {
  formatFilesFromFolder(targetPath)
}

const formatFilesFromFolder = (folderPath: string) => {
  try {
    const files: string[] = readdirSync(path.join(process.cwd(), folderPath))
    if (files.length === 0) {
      return
    }

    files.forEach((fileName) => {
      if (
        IGNORE_FOLDERS.includes(fileName) ||
        IGNORE_EXTENSIONS.some((ext) => fileName.endsWith(ext)) ||
        fileName.startsWith('.')
      ) {
        return
      }

      const fileStatus = ora(fileName)
      try {
        const filePath = path.join(process.cwd(), folderPath, fileName)
        const isDirectory = lstatSync(filePath).isDirectory()
        if (!isDirectory) {
          const file = readFileSync(filePath)
          const fileExtension = path.extname(filePath)?.substring(1)
          const processor = processors[fileExtension]
          if (processor) {
            const formattedCode = processor({ [fileExtension]: file.toString('utf-8') })
            writeFileSync(filePath, formattedCode[fileExtension])
            fileStatus.succeed()
          }
          return
        }
        formatFilesFromFolder(path.join(folderPath, fileName))
      } catch (e) {
        fileStatus.text = `Failed in formatting file ${fileName}`
        fileStatus.fail()
      }
    })
  } catch (e) {
    console.warn(e)
  }
}

export default format
