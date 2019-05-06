import { createVueComponentGenerator } from '../../../packages/teleport-component-generator-vue/lib'
// @ts-ignore
import componentJSON from './sample.json.js'
import { writeFolder, removeDir } from '../../project-exporters/utils/path-utils'
import { GeneratedFolder } from '../../../packages/teleport-generator-shared/lib/typings/generators'

// @ts-ignore
const generator = createVueComponentGenerator()

const writeToDisk = async (files) => {
  try {
    const folder: GeneratedFolder = { name: 'dist', files, subFolders: [] }
    await removeDir(`${__dirname}/dist`)
    await writeFolder(folder, __dirname)
  } catch (e) {
    console.warn(e)
  }
}

generator
  .generateComponent(componentJSON)
  .then((res) => {
    const { files } = res
    writeToDisk(files)
  })
  .catch((err) => console.warn(err))
