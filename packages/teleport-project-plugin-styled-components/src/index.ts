import { ProjectPlugin, ProjectPluginStructure, ProjectType } from '@teleporthq/teleport-types'
import { gatsbyAfterModifier, gatsbyBeforeModifier } from './gatsby'
import { nextAfterModifier, nextBeforeModifier } from './next'
import { reactAfterModifier, reactBeforeModifier } from './react'

type SUPPORTED_FRAMEWORKS = ProjectType.NEXT | ProjectType.REACT | ProjectType.GATSBY

const frameworkBeforeMap: Record<
  SUPPORTED_FRAMEWORKS,
  (structure: ProjectPluginStructure) => Promise<void>
> = {
  [ProjectType.NEXT]: nextBeforeModifier,
  [ProjectType.REACT]: reactBeforeModifier,
  [ProjectType.GATSBY]: gatsbyBeforeModifier,
}

const frameworkAfterModifier: Record<
  SUPPORTED_FRAMEWORKS,
  (structure: ProjectPluginStructure) => Promise<void>
> = {
  [ProjectType.NEXT]: nextAfterModifier,
  [ProjectType.REACT]: reactAfterModifier,
  [ProjectType.GATSBY]: gatsbyAfterModifier,
}

export class ProjectPluginStyledComponents implements ProjectPlugin {
  framework: SUPPORTED_FRAMEWORKS

  constructor(params: { framework: SUPPORTED_FRAMEWORKS }) {
    this.framework = params.framework
  }

  async runBefore(structure: ProjectPluginStructure) {
    const beforeModifier = frameworkBeforeMap[this.framework]
    if (!beforeModifier) {
      return structure
    }

    await beforeModifier(structure)
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const afterModifier = frameworkAfterModifier[this.framework]
    if (!afterModifier) {
      return structure
    }

    await afterModifier(structure)
    return structure
  }
}
