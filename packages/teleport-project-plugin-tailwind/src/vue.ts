import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'

export const vueModifier = async (
  structure: ProjectPluginStructure,
  config: Record<string, unknown>,
  content: string[],
  css: string
): Promise<void> => {
  const { files } = structure
  config.content = content

  const projectSheet = files
    .get('projectStyleSheet')
    ?.files.find((file) => file.name === 'style' && file.fileType === FileType.CSS)

  if (projectSheet) {
    files.delete('projectStyleSheet')
    files.set('projectStyleSheet', {
      path: ['src'],
      files: [
        {
          ...projectSheet,
          content: `${css}\n${projectSheet.content}`,
        },
      ],
    })
  }

  files.set('tailwindConfig', {
    files: [
      {
        name: 'tailwind.config',
        fileType: FileType.JS,
        content: `module.exports = ${JSON.stringify(config, null, 2)}`,
      },
      {
        name: 'postcss.config',
        fileType: FileType.JS,
        content: `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};`,
      },
    ],
    path: [''],
  })
}
