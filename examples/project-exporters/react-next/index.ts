// @ts-ignore
import path from 'path'
import { removeDir, copyDirRec, readJSON, writeFolder } from '../utils/path-utils'

// @ts-ignore
import projectJson from '../../uidl-samples/project-state-components.json'

import { UIDLTypes, GeneratorTypes, UIDLValidators, createReactNextProject } from '../../../src'

const writeToDisk = async (
  projectUIDL: UIDLTypes.ProjectUIDL,
  generatorFunction: GeneratorTypes.ProjectGeneratorFunction,
  templatePath: string = 'project-template',
  distPath: string = 'dist'
) => {
  // @ts-ignore
  await removeDir(path.join(__dirname, distPath))
  // @ts-ignore
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
  // @ts-ignore
  await writeFolder(outputFolder, __dirname)
}

// const runInMemory = async (
//   projectUIDL: ProjectUIDL,
//   generatorFunction: ProjectGeneratorFunction
// ) => {
//   const result = await generatorFunction(projectUIDL)
//   console.log(JSON.stringify(result, null, 2))
// }

// tslint:disable-next-line: no-console
console.log(UIDLValidators.validateProject(projectJson))
// @ts-ignore
writeToDisk(projectJson, createReactNextProject, path.join(__dirname, 'project-template'), 'dist')
// runInMemory(projectJson, createNextProject)
