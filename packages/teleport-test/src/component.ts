import { createHTMLComponentGenerator } from '@teleporthq/teleport-component-generator-html'
import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
// import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
import componentJSON from '../../../examples/test-samples/component-html.json'
import { component, dynamicNode, elementNode, staticNode } from '@teleporthq/teleport-uidl-builders'
import { GeneratedFile } from '@teleporthq/teleport-types'
import { writeFile } from 'fs'
import { join } from 'path'

const run = async () => {
  const generator = createHTMLComponentGenerator()
  generator.addExternalComponents({
    externals: {
      sample: component(
        'Sample',
        elementNode('container', {}, [staticNode('Hello'), dynamicNode('prop', 'heading')], null, {
          width: staticNode('100px'),
        }),
        { heading: { type: 'string', defaultValue: 'TeleportHQ' } }
      ),
    },
  })

  const { files } = await generator.generateComponent(componentJSON)
  addfilesToDisk(files)

  const reactGenerator = createReactComponentGenerator()
  const { files: reactFiles } = await reactGenerator.generateComponent(
    component(
      'Test Code Embed Component',
      elementNode('html-node', {
        html: {
          type: 'raw',
          content: `<script src'https://unpkg.com/@lottiefiles/lottie-player@latest/dist/lottie-player.js'></script> <lottie-player src='https://assets6.lottiefiles.com/packages/lf20_gSMVZV7ZdZ.json'  background='transparent'  speed='1'  style='width: 300px; height: 300px;'  loop controls autoplay></lottie-player>`,
        },
      })
    )
  )
  addfilesToDisk(reactFiles)
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
