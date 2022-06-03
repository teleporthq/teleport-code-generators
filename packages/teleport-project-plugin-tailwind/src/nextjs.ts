import { FileType, ProjectPluginStructure } from '@teleporthq/teleport-types'

export const nextJSTailwindModifier = async (
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
      path: ['pages'],
      files: [
        {
          ...projectSheet,
          content: `${css}\n${projectSheet.content}`,
        },
      ],
    })
  } else {
    const rootFolder = files.get('_app')
    const rootFile = rootFolder?.files.find(
      (file) => file.name === '_app' && file.fileType === FileType.JS
    )

    if (!rootFile) {
      throw new Error(`Entry _app.js is missing from the project. Please check the project`)
    }

    files.delete('_app')
    files.set('_app', {
      files: [
        ...(rootFolder?.files || []).filter(
          (file) => file.name !== '_app' && file.fileType === FileType.JS
        ),
        {
          ...rootFile,
          content: `import "./global.css"\n${rootFile.content}`,
        },
      ],
      path: ['pages'],
    })
    files.set('tailwindGlobal', {
      files: [
        {
          name: 'global',
          fileType: FileType.CSS,
          content: css,
        },
      ],
      path: ['pages'],
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
