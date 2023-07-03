import { ProjectPlugin, ProjectPluginStructure, ProjectType } from '@teleporthq/teleport-types'
import { nextAfterModifier, nextBeforeModifier } from './next'

type SUPPORTED_FRAMEWORKS = ProjectType.NEXT

const frameworkBeforeMap: Record<
  SUPPORTED_FRAMEWORKS,
  (strucutre: ProjectPluginStructure) => ProjectPluginStructure
> = {
  [ProjectType.NEXT]: nextBeforeModifier,
}

const frameworkAfterMap: Record<
  SUPPORTED_FRAMEWORKS,
  (strucutre: ProjectPluginStructure) => ProjectPluginStructure
> = {
  [ProjectType.NEXT]: nextAfterModifier,
}

export class ProjectPluginInlineFetch implements ProjectPlugin {
  framework: SUPPORTED_FRAMEWORKS

  constructor(params: { framework: SUPPORTED_FRAMEWORKS }) {
    this.framework = params.framework
  }

  async runBefore(structure: ProjectPluginStructure) {
    const beforeModifier = frameworkBeforeMap[this.framework]
    if (!beforeModifier) {
      return structure
    }
    return beforeModifier(structure)
  }

  async runAfter(structure: ProjectPluginStructure) {
    const afterModifier = frameworkAfterMap[this.framework]
    if (!afterModifier) {
      return structure
    }
    return afterModifier(structure)
  }
}
