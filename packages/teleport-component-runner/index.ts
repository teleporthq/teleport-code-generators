import { createGenerator } from '@teleporthq/teleport-component-generator'
// import { createReactComponentGenerator } from '@teleporthq/teleport-component-generator-react'
// import { createVueComponentGenerator } from '@teleporthq/teleport-component-generator-vue'
// import createReactProjectGenerator from '@teleporthq/teleport-project-generator-react-basic'
import createVueProjectGenerator from '@teleporthq/teleport-project-generator-vue-basic'

import reactPlugin from '@teleporthq/teleport-plugin-react-base-component'
import styledComponentPlugin from '@teleporthq/teleport-plugin-react-styled-components'
import propTypesPlugin from '@teleporthq/teleport-plugin-react-proptypes'
import importStatementsPlugin from '@teleporthq/teleport-plugin-import-statements'

// import prettierJS from '@teleporthq/teleport-postprocessor-prettier-js'

// import component from './uidl.json'
import project from './project.json'
import reactMapping from './react-mapping.json'
// import { ComponentGenerator } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

// const reactGenerator = createReactComponentGenerator({ variation: 'CSSModules' })
// const vueGenerator = createVueComponentGenerator()
const genericGenerator = createGenerator()

genericGenerator.addMapping(reactMapping)

genericGenerator.addPlugin(reactPlugin)
genericGenerator.addPlugin(styledComponentPlugin)
genericGenerator.addPlugin(propTypesPlugin)
genericGenerator.addPlugin(importStatementsPlugin)

// genericGenerator.addPostProcessor(prettierJS)

// const run = async (uidl: ComponentUIDL, generator: ComponentGenerator) => {
//   const result = await generator.generateComponent(uidl)
//   result.files.forEach((file) => {
//     console.info('\nStart of output --------------')
//     console.info('Filename:', file.name)
//     console.info('Extension:', file.fileType)
//     console.info('Content:\n')
//     console.info(file.content)
//     console.info('End of output --------------')
//   })
// }

const run = async (createProjectGenerator) => {
  const projectGen = createProjectGenerator()
  const { outputFolder } = await projectGen.generateProject(project, {})
  console.info(JSON.stringify(outputFolder, null, 2))
}

run(createVueProjectGenerator)

// run(component as ComponentUIDL, genericGenerator)
// run(component as ComponentUIDL, reactGenerator)
// run(component as ComponentUIDL, vueGenerator)
