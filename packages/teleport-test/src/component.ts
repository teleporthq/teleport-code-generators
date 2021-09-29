import { createHTMLComponentGenerator } from '@teleporthq/teleport-component-generator-html'
import componentJSON from '../../../examples/test-samples/component-basic.json'
import { component, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { writeFile } from 'fs'
import { join } from 'path'

const run = async () => {
  const generator = createHTMLComponentGenerator()
  generator.addExternalComponents({
    sample: component('Sample', elementNode('container', {}, [staticNode('Hello World')])),
  })

  const { files } = await generator.generateComponent(componentJSON)
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
