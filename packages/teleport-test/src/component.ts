import { join } from 'path'
import { writeFile } from 'fs'
import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
import { createAngularComponentGenerator } from '@teleporthq/teleport-component-generator-angular'
import { GeneratedFile } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/uidl-samples/component.json'

const run = async () => {
  const generator = createVueComponentGenerator()
  const reactGenerator = createReactComponentGenerator()
  const angularGenerator = createAngularComponentGenerator()

  const result = await generator.generateComponent(uidlSample)
  addfilesToDisk(result.files)

  const reactFiles = await reactGenerator.generateComponent(uidlSample)
  addfilesToDisk(reactFiles.files)

  const angularFiles = await angularGenerator.generateComponent(uidlSample)
  addfilesToDisk(angularFiles.files)
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
