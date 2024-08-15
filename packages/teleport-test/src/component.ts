import { join } from 'path'
import { writeFile } from 'fs'
import { createHTMLComponentGenerator } from '@teleporthq/teleport-component-generator-html'
import { GeneratedFile } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/uidl-samples/component.json'

const run = async () => {
  const generator = createHTMLComponentGenerator()
  const result = await generator.generateComponent(uidlSample)
  addfilesToDisk(result.files)
}

const addfilesToDisk = (files: GeneratedFile[]) => {
  files.forEach((file) => {
    const filePath = join(__dirname, '../dist', `${file.name}.${file.fileType}`)

    writeFile(filePath, file.content, 'utf-8', (err) => {
      if (err) {
        throw err
      }
    })
  })
}

run()
