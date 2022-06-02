import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'

export const defaultTailwindModifier = async (
  structure: ProjectPluginStructure,
  config: Record<string, unknown>,
  content: string[],
  css: string
): Promise<void> => {
  const { files, devDependencies } = structure
  config.content = content

  const projectSheet = files
    .get('projectStyleSheet')
    ?.files.find((file) => file.name === 'style' && file.fileType === FileType.CSS)

  if (projectSheet) {
    files.delete('projectStyleSheet')
    files.set('projectStyleSheet', {
      path: ['src', 'teleporthq'],
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

  devDependencies.tailwindcss = '^3.0.24'
  devDependencies.autoprefixer = '^9.8.6'
  devDependencies.postcss = '^8.2.15'
}
