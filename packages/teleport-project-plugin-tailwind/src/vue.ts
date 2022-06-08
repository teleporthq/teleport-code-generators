import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { AUTO_PREFIXER, POSTCSS, TAILWIND } from './constants'

export const vueTailwindModifier = async (
  structure: ProjectPluginStructure,
  config: Record<string, unknown>,
  css: string
): Promise<void> => {
  const { devDependencies, files, rootFolder } = structure
  config.content = ['./src/**/*.{vue,js,ts,jsx,tsx}']

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
    ],
    path: [''],
  })

  rootFolder.files.forEach((file) => {
    const { name, fileType } = file

    if (name === 'package' && fileType === 'json') {
      const jsonContent = JSON.parse(file.content)
      if (jsonContent?.postcss) {
        jsonContent.postcss.plugins = {
          ...(jsonContent.postcss?.plugins || {}),
          tailwindcss: {},
        }
      } else {
        jsonContent.postcss = {
          plugins: {
            autoprefixer: {},
            tailwindcss: {},
          },
        }
      }
      file.content = JSON.stringify(jsonContent, null, 2)
    }
  })

  devDependencies.autoprefixer = AUTO_PREFIXER
  devDependencies.postcss = POSTCSS
  devDependencies.tailwindcss = TAILWIND
  devDependencies['postcss-loader'] = '^7.0.0'
}
