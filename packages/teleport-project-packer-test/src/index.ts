import projectPacker from '@teleporthq/teleport-project-packer'

import reactGenerator from '@teleporthq/teleport-project-generator-react-basic'
import reactNextGenerator from '@teleporthq/teleport-project-generator-react-next'
import vueGenerator from '@teleporthq/teleport-project-generator-vue-basic'
import vueNuxtGenerator from '@teleporthq/teleport-project-generator-vue-nuxt'

import { createDiskPublisher } from '@teleporthq/teleport-publisher-disk'
import { ProjectUIDL } from '@teleporthq/teleport-types'

import projectUIDL from '../../../examples/uidl-samples/project.json'

const generators = {
  'react-basic': reactGenerator,
  'react-next': reactNextGenerator,
  'vue-basic': vueGenerator,
  'vue-nuxt': vueNuxtGenerator,
}

const publisher = createDiskPublisher({ outputPath: 'dist' })

const packProject = async (projectType: string) => {
  const template = {
    templateFolder: {
      name: projectType,
      files: [],
      subFolders: [],
    },
  }

  projectPacker.setPublisher(publisher)
  projectPacker.setTemplate(template)
  projectPacker.setGeneratorFunction(generators[projectType].generateProject)

  const result = await projectPacker.pack(projectUIDL as ProjectUIDL)

  console.info(projectType, ' - ', result)
}

const run = async () => {
  await packProject('react-basic')
  await packProject('react-next')
  await packProject('vue-basic')
  await packProject('vue-nuxt')
}

run()
