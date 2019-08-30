import {
  createPlaygroundPacker,
  PublisherType,
  GeneratorType,
} from '@teleporthq/teleport-project-packer-playground'
import { ProjectUIDL } from '@teleporthq/teleport-types'

import projectUIDL from '../../../examples/uidl-samples/project.json'

const uidl = (projectUIDL as unknown) as ProjectUIDL
const packer = createPlaygroundPacker({
  publisher: PublisherType.DISK,
  publishOptions: {
    outputPath: 'dist',
  },
})

const run = async () => {
  try {
    await packer.pack(uidl, { generator: GeneratorType.REACT })
    console.info(GeneratorType.REACT, ' - done')
    await packer.pack(uidl, { generator: GeneratorType.NEXT })
    console.info(GeneratorType.NEXT, ' - done')
    await packer.pack(uidl, { generator: GeneratorType.NUXT })
    console.info(GeneratorType.NUXT, ' - done')
    await packer.pack(uidl, { generator: GeneratorType.VUE })
    console.info(GeneratorType.VUE, ' - done')
    await packer.pack(uidl, { generator: GeneratorType.STENCIL })
    console.info(GeneratorType.STENCIL, ' - done')
    await packer.pack(uidl, { generator: GeneratorType.PREACT })
    console.info(GeneratorType.PREACT, ' - done')
  } catch (e) {
    console.info(e)
  }
}

run()
