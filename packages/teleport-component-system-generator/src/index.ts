import { ComponentUIDL, ComponentGenerator, GeneratedFolder } from '@teleporthq/teleport-types'
import reactGenerator from '@teleporthq/teleport-component-generator-react'

interface ComponentSystemGeneratorParams {
  generator?: ComponentGenerator
}

export const createComponentSystemGenerator = (params: ComponentSystemGeneratorParams = {}) => {
  let componentGenerator = params.generator || reactGenerator

  const generateComponentSystem = async (components: ComponentUIDL[]) => {
    const allFiles = []

    for (const component of components) {
      const { files } = await componentGenerator.generateComponent(component)
      allFiles.push(...files)
    }

    const folder: GeneratedFolder = {
      name: 'components',
      files: allFiles,
      subFolders: [],
    }

    return folder
  }

  const updateComponentGenerator = (generator: ComponentGenerator) => {
    componentGenerator = generator
  }

  return {
    generateComponentSystem,
    updateComponentGenerator,
  }
}

export default createComponentSystemGenerator()
