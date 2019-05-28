import createProjectPacker from '@teleporthq/teleport-project-packer'

import createReactGenerator from '@teleporthq/teleport-project-generator-react-basic'
import createReactNextGenerator from '@teleporthq/teleport-project-generator-react-next'
import createVueGenerator from '@teleporthq/teleport-project-generator-vue-basic'
import createVueNuxtGenerator from '@teleporthq/teleport-project-generator-vue-nuxt'

import createDiskPublisher from '@teleporthq/teleport-publisher-disk'
import { ProjectUIDL } from '@teleporthq/teleport-generator-shared/lib/typings/uidl'

import projectUIDL from '../../../examples/uidl-samples/project.json'

const generators = {
  'react-basic': createReactGenerator(),
  'react-next': createReactNextGenerator(),
  'vue-basic': createVueGenerator(),
  'vue-nuxt': createVueNuxtGenerator(),
}

const packer = createProjectPacker()
const publisher = createDiskPublisher({ outputPath: 'dist' })

const packProject = async (projectType: string) => {
  const template = {
    templateFolder: {
      name: projectType,
      files: [],
      subFolders: [],
    },
  }

  packer.setPublisher(publisher)
  packer.setTemplate(template)
  packer.setGeneratorFunction(generators[projectType].generateProject)

  const result = await packer.pack(projectUIDL as ProjectUIDL)

  console.info(projectType, ' - ', result)
}

const run = async () => {
  // await packProject('react-basic')
  // await packProject('react-next')
  await packProject('vue-basic')
  // await packProject('vue-nuxt')
}

run()
