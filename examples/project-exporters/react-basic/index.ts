import path from 'path'
import { removeDir, copyDirRec, readJSON, writeFolder } from '../utils/path-utils'

// @ts-ignore
import projectJson from '../../uidl-samples/project.json'
// @ts-ignore
import customMapping from './custom-mapping.json'

import createReactBasicGenerator from '@teleporthq/teleport-project-generator-react-basic'
import { ProjectUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'
import { ProjectGeneratorFunction } from '@teleporthq/teleport-generator-shared/lib/typings/generators'

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
      customMapping,
    })
    await writeFolder(outputFolder, __dirname)
  } catch (error) {
    throw new Error(error)
  }
}

const generator = createReactBasicGenerator()

writeToDisk(
  // @ts-ignore
  projectJson as ProjectUIDL,
  generator.generateProject,
  path.join(__dirname, 'project-template'),
  'dist'
)
