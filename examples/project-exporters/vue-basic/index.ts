import path from 'path'
import { removeDir, copyDirRec, readJSON, writeFolder } from '../utils/path-utils'

// @ts-ignore
import projectJson from '../../uidl-samples/project-state-components.json'

import { UIDLValidators, createVueBasicProject } from '../../../src'

const writeToDisk = async (
  // @ts-ignore
  projectUIDL: ProjectUIDL,
  // @ts-ignore
  generatorFunction: ProjectGeneratorFunction,
  templatePath: string = 'project-template',
  distPath: string = 'dist'
) => {
  await removeDir(path.join(__dirname, distPath))
  await copyDirRec(templatePath, path.join(__dirname, distPath))
  const packageJsonTemplate = path.join(templatePath, 'package.json')
  const packageJson = await readJSON(packageJsonTemplate)
  if (!packageJson) {
    throw new Error('could not find a package.json in the template folder')
  }

  const { outputFolder } = await generatorFunction(projectUIDL, {
    sourcePackageJson: packageJson,
    distPath,
  })
  await writeFolder(outputFolder, __dirname)
}

// const runInMemory = async (
//   projectUIDL: ProjectUIDL,
//   generatorFunction: ProjectGeneratorFunction
// ) => {
//   const result = await generatorFunction(projectUIDL)
//   console.log(JSON.stringify(result, null, 2))
// }

console.info(UIDLValidators.validateProject(projectJson))

writeToDisk(projectJson, createVueBasicProject, path.join(__dirname, 'project-template'), 'dist')
// runInMemory(projectJson, createVueProject)
