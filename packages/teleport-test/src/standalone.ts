import { readFileSync } from 'fs'
import { join } from 'path'
import {
  createCodeGenerator,
  PublisherType,
  ProjectType,
} from '@teleporthq/teleport-code-generator'
import { ProjectUIDL } from '@teleporthq/teleport-types'

import projectJSON from '../../../examples/uidl-samples/project.json'

const projectUIDL = (projectJSON as unknown) as ProjectUIDL
const assetFile = readFileSync(join(__dirname, 'asset.png'))
const base64File = new Buffer(assetFile).toString('base64')
const packer = createCodeGenerator({
  publisher: PublisherType.DISK,
  publishOptions: {
    outputPath: 'dist',
  },
  assets: [
    {
      type: 'png',
      name: 'icons-192',
      data: base64File,
    },
    {
      type: 'png',
      name: 'icons-512',
      data: base64File,
    },
  ],
})

const run = async () => {
  try {
    let result
    result = await packer.packProject(projectUIDL, { projectType: ProjectType.REACT })
    console.info(ProjectType.REACT, '-', result.payload)
    result = await packer.packProject(projectUIDL, { projectType: ProjectType.NEXT })
    console.info(ProjectType.NEXT, '-', result.payload)
    result = await packer.packProject(projectUIDL, { projectType: ProjectType.NUXT })
    console.info(ProjectType.NUXT, '-', result.payload)
    result = await packer.packProject(projectUIDL, { projectType: ProjectType.VUE })
    console.info(ProjectType.VUE, '-', result.payload)
    result = await packer.packProject(projectUIDL, { projectType: ProjectType.STENCIL })
    console.info(ProjectType.STENCIL, '-', result.payload)
    result = await packer.packProject(projectUIDL, { projectType: ProjectType.PREACT })
    console.info(ProjectType.PREACT, '-', result.payload)
  } catch (e) {
    console.info(e)
  }
}

run()
