import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { AUTO_PREFIXER, POSTCSS, TAILWIND } from './constants'

export const angularTailwindModifier = async (
  structure: ProjectPluginStructure,
  config: Record<string, unknown>,
  css: string
): Promise<void> => {
  const { devDependencies, files } = structure
  config.content = ['./src/**/*.{html,ts}']

  const projectSheet = files
    .get('projectStyleSheet')
    ?.files.find((file) => file.name === 'styles' && file.fileType === FileType.CSS)
  let globalStyleSheet = css

  if (projectSheet) {
    files.delete('projectStyleSheet')
    globalStyleSheet = `${globalStyleSheet} \n \n ${projectSheet.content}`
  }

  files.set('projectStyleSheet', {
    path: ['src'],
    files: [
      {
        ...projectSheet,
        content: globalStyleSheet,
      },
    ],
  })

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

  devDependencies.autoprefixer = AUTO_PREFIXER
  devDependencies.postcss = POSTCSS
  devDependencies.tailwindcss = TAILWIND
}
