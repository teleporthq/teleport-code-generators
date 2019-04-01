// import path from 'path'
// import { removeDir, copyDirRec, readJSON, writeFolder } from '../utils/path-utils'

// // @ts-ignore
// import projectJson from '../../uidl-samples/project-state-components.json'
// // @ts-ignore
// import customMapping from './custom-mapping.json'

// import { createReactBasicGenerator } from '../../../src'

// const writeToDisk = async (
//   // @ts-ignore
//   projectUIDL: ProjectUIDL,
//   // @ts-ignore
//   generatorFunction: ProjectGeneratorFunction,
//   templatePath: string = 'project-template',
//   distPath: string = 'dist'
// ) => {
//   await removeDir(path.join(__dirname, distPath))
//   await copyDirRec(templatePath, path.join(__dirname, distPath))
//   const packageJsonTemplate = path.join(templatePath, 'package.json')
//   const packageJson = await readJSON(packageJsonTemplate)
//   if (!packageJson) {
//     throw new Error('could not find a package.json in the template folder')
//   }

//   const { outputFolder } = await generatorFunction(projectUIDL, {
//     sourcePackageJson: packageJson,
//     distPath,
//     customMapping,
//   })
//   await writeFolder(outputFolder, __dirname)
// }

// const generator = createReactBasicGenerator()

// writeToDisk(
//   // @ts-ignore
//   projectJson as ProjectUIDL,
//   generator.generateProject,
//   path.join(__dirname, 'project-template'),
//   'dist'
// )

import createVueComponentGenerator from '../../../src/component-generators/vue/vue-component'
import createReactComponentGenerator from '../../../src/component-generators/react/react-component'
import newComponentJSON from '../../uidl-samples/new.json'

const vue = createVueComponentGenerator()
const react = createReactComponentGenerator()

const run = async () => {
  console.log('\n\nVue-----')
  const vueResult = await vue.generateComponent(newComponentJSON as ComponentUIDL, {
    skipValidation: true,
  })
  console.log(vueResult.code)

  console.log('\n\nReact-----')
  const reactResult = await react.generateComponent(newComponentJSON as ComponentUIDL, {
    skipValidation: true,
  })
  console.log(reactResult.code)
}

run()
