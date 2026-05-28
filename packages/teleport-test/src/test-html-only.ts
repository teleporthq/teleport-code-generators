import { packProject } from '@teleporthq/teleport-code-generator'
import { ProjectUIDL, PackerOptions, ProjectType, PublisherType } from '@teleporthq/teleport-types'
import { ProjectPluginParseEmbed } from '@teleporthq/teleport-project-plugin-parse-embed'
import projectJSON from '../../../examples/uidl-samples/project.json'

/* tslint:disable:no-console */

const projectUIDL = projectJSON as unknown as ProjectUIDL

const packerOptions: PackerOptions = {
  publisher: PublisherType.DISK,
  projectType: ProjectType.HTML,
  publishOptions: {
    outputPath: 'dist-html-only',
  },
  assets: [],
}

packProject(projectUIDL, {
  ...packerOptions,
  projectType: ProjectType.HTML,
  plugins: [new ProjectPluginParseEmbed()],
  publishOptions: {
    projectSlug: 'test-html-only',
    outputPath: 'dist-html-only',
  },
  strictHtmlWhitespaceSensitivity: false,
})
  .then(() => {
    console.log('HTML project generated successfully!')
  })
  .catch((err) => {
    console.error('ERROR:', err.message)
    console.error('Stack:', err.stack)
  })
