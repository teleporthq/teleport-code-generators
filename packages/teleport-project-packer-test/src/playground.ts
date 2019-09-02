import {
  createPlaygroundPacker,
  PublisherType,
  ProjectType,
  ComponentType,
  ComponentStyleVariations,
} from '@teleporthq/teleport-project-packer-playground'
import { ProjectUIDL, UIDLElement } from '@teleporthq/teleport-types'

import projectJSON from '../../../examples/uidl-samples/project.json'

const projectUIDL = (projectJSON as unknown) as ProjectUIDL
const componentUIDL = projectUIDL.components.ExpandableArea
const packer = createPlaygroundPacker({
  publisher: PublisherType.DISK,
  publishOptions: {
    outputPath: 'dist',
  },
})

const run = async () => {
  try {
    await packer.packProject(projectUIDL, { projectType: ProjectType.REACT })
    console.info(ProjectType.REACT, ' - done')
    await packer.packProject(projectUIDL, { projectType: ProjectType.NEXT })
    console.info(ProjectType.NEXT, ' - done')
    await packer.packProject(projectUIDL, { projectType: ProjectType.NUXT })
    console.info(ProjectType.NUXT, ' - done')
    await packer.packProject(projectUIDL, { projectType: ProjectType.VUE })
    console.info(ProjectType.VUE, ' - done')
    await packer.packProject(projectUIDL, { projectType: ProjectType.STENCIL })
    console.info(ProjectType.STENCIL, ' - done')
    await packer.packProject(projectUIDL, { projectType: ProjectType.PREACT })
    console.info(ProjectType.PREACT, ' - done')

    const componentType = ComponentType.REACT
    const componentStyleVariation = ComponentStyleVariations[componentType].CSSModules

    const result = await packer.generateComponent(componentUIDL, {
      componentType,
      componentStyleVariation,
    })
    console.info(ComponentType.REACT, JSON.stringify(result, null, 2))

    const element = packer.resolveElement(componentUIDL.node.content as UIDLElement)
    console.info(element)
  } catch (e) {
    console.info(e)
  }
}

run()
