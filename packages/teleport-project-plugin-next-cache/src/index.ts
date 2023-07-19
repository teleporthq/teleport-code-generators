import { ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { FileType } from '@teleporthq/teleport-types/src'

export class ProjectPluginNextCache implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const { uidl, files } = structure
    if (typeof uidl.resources?.cache?.revalidate !== 'object') {
      return structure
    }

    const dependency = uidl.resources.cache.revalidate

    files.set(`cache-validator`, {
      path: ['pages', 'api'],
      files: [
        {
          name: 'revalidate',
          fileType: FileType.JS,
          content: `import { revalidate } from "${dependency.path}"
import { revalidatePath } from 'next/cache'
import routeMappers from '../../teleport-config.json'

export default async function handler(req, res) {
  try {
    const pathsToRevalidate = await revalidate(req, routeMappers);
    pathsToRevalidate.forEach((path) => {
      console.log("[ON-DEMAND_ISR]: Clearing cahce for path", path)
      revalidatePath(path)
    })
    return res.status(200).json({ revalidated: true });
  } catch {
    return res.status(500).json({ revalidated: false })
  }
}`,
        },
      ],
    })

    files.set(`teleport-config`, {
      path: [],
      files: [
        {
          name: 'teleport-config',
          fileType: FileType.JSON,
          content: `{}`,
        },
      ],
    })

    return structure
  }
}
