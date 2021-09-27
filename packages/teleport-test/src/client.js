import { resolveUIDLElement } from '@teleporthq/teleport-uidl-resolver'
import { ProjectType, PublisherType } from '@teleporthq/teleport-types'
import uidl from '../../../examples/uidl-samples/component.json'
import projectUIDL from '../../../examples/uidl-samples/project.json'
import config from '../config.json'

const resolvedElement = resolveUIDLElement({ elementType: 'container' })
console.log(resolvedElement)

const run = async () => {
  import('./codegen').then((service) => {
    generate(service.default)
  })
}

const generate = async (service) => {
  console.log('service', service)
  const result = await service.generateComponent(uidl)
  console.log(result)
}

run()

window.deployToVercel = async () => {
  const packProject = await import('@teleporthq/teleport-code-generator').then((mod) => {
    return mod.packProject
  })
  if (!packProject) {
    throw new Error(`packProject is missing`)
  }
  console.log(packProject)
  const packerOptions = {
    publisher: PublisherType.VERCEL,
    projectType: ProjectType.REACT,
    publishOptions: {
      outputPath: 'dist',
      individualUpload: true,
      accessToken: config.token,
    },
    assets: [
      {
        content:
          'https://placekitten.com/500/300',
        name: 'kitten',
        location: 'remote',
      }
    ],
  }
  const result = await packProject(projectUIDL, packerOptions)
  console.log(result)
}