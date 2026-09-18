import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { injectSiblingIntoApp } from '../app-sibling-injection'
import { generateBodyCodeComponentCode } from './body-code-component'

/**
 * Ships the body-code unpacker only when the project has body custom code:
 * one null-rendering component next to the app's JSX, no npm dependency.
 * _document's counterpart (wrapBodyCustomCode) writes the inert template.
 */
export class NextBodyCodeProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    if (!structure.uidl.globals.customCode?.body?.trim()) {
      return structure
    }
    structure.files.set('tq-body-code', {
      path: ['components'],
      files: [
        {
          name: 'tq-body-code',
          fileType: FileType.JS,
          content: generateBodyCodeComponentCode(),
        },
      ],
    })
    injectSiblingIntoApp(structure, {
      componentName: 'TqBodyCode',
      importStatement: `import TqBodyCode from '../components/tq-body-code';\n`,
    })
    return structure
  }
}
