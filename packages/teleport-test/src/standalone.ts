import { readFileSync } from 'fs'
import { join } from 'path'
import { packProject } from '@teleporthq/teleport-code-generator'
import { ProjectUIDL, PackerOptions, ProjectType, PublisherType } from '@teleporthq/teleport-types'

import projectJSON from '../../../examples/uidl-samples/project.json'

const projectUIDL = (projectJSON as unknown) as ProjectUIDL
const assetFile = readFileSync(join(__dirname, 'asset.png'))
const base64File = new Buffer(assetFile).toString('base64')
const packerOptions: PackerOptions = {
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
}

const run = async () => {
  try {
    let result
    result = await packProject(projectUIDL, { ...packerOptions, projectType: ProjectType.REACT })
    console.info(ProjectType.REACT, '-', result.payload)
    result = await packProject(projectUIDL, { ...packerOptions, projectType: ProjectType.NEXT })
    console.info(ProjectType.NEXT, '-', result.payload)
    result = await packProject(projectUIDL, { ...packerOptions, projectType: ProjectType.NUXT })
    console.info(ProjectType.NUXT, '-', result.payload)
    result = await packProject(projectUIDL, { ...packerOptions, projectType: ProjectType.VUE })
    console.info(ProjectType.VUE, '-', result.payload)
    result = await packProject(projectUIDL, { ...packerOptions, projectType: ProjectType.STENCIL })
    console.info(ProjectType.STENCIL, '-', result.payload)
    result = await packProject(projectUIDL, { ...packerOptions, projectType: ProjectType.PREACT })
    console.info(ProjectType.PREACT, '-', result.payload)
    result = await packProject(projectUIDL, { ...packerOptions, projectType: ProjectType.ANGULAR })
    console.info(ProjectType.ANGULAR, '-', result.payload)
    result = await packProject(projectUIDL, { ...packerOptions, projectType: ProjectType.GRIDSOME })
    console.info(ProjectType.GRIDSOME, '-', result.payload)
  } catch (e) {
    console.info(e)
  }
}

run()
