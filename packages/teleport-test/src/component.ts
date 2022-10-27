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
      'Test Component',
      elementNode('embed', {
        html: {
          type: 'raw',
          content: `<table id="producttable">
        <thead>
          <tr>
            <td>UPC_Code</td>
            <td>Product_Name</td>
          </tr>
        </thead>
        <tbody>
          <!-- existing data could optionally be included here -->
        </tbody>
      </table>
      
      <template id="productrow">
        <tr>
          <td class="record"></td>
          <td></td>
        </tr>
      </template>
      `,
        },
        // attr2: { type: 'static', content: '<div>Container<div>' },
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
