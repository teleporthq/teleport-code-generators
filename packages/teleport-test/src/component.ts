import { join } from 'path'
import { writeFile } from 'fs'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { GeneratedFile, ReactStyleVariation } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/component-sample.json'

const run = async () => {
  const generator = createReactComponentGenerator({
    variation: ReactStyleVariation.StyledComponents,
  })
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
