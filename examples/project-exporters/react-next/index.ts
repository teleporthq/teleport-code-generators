import path from 'path'
import { removeDir, copyDirRec, readJSON, writeFolder } from '../utils/path-utils'

// @ts-ignore
import projectJson from '../../uidl-samples/new-project.json'

import { createReactNextGenerator } from '../../../src'
import { ProjectUIDL } from '../../../src/typings/uidl-definitions'
import { ProjectGeneratorFunction } from '../../../src/typings/generators'

const writeToDisk = async (
  projectUIDL: ProjectUIDL,
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

  try {
    const { outputFolder } = await generatorFunction(projectUIDL, {
      sourcePackageJson: packageJson,
      distPath,
    })
    await writeFolder(outputFolder, __dirname)
  } catch (error) {
    throw new Error(error)
  }
}

// const runInMemory = async (
//   projectUIDL: ProjectUIDL,
//   generatorFunction: ProjectGeneratorFunction
// ) => {
//   const result = await generatorFunction(projectUIDL)
//   console.log(JSON.stringify(result, null, 2))
// }

const generator = createReactNextGenerator()
writeToDisk(
  // @ts-ignore
  projectJson as ProjectUIDL,
  generator.generateProject,
  path.join(__dirname, 'project-template'),
  'dist'
)

// runInMemory(projectJson, createNextProject)
