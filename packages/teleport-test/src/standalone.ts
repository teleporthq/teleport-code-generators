// @ts-nocheck
import { readFileSync, rmdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { packProject } from '@teleporthq/teleport-code-generator'
import {
  ProjectUIDL,
  PackerOptions,
  ProjectType,
  PublisherType,
  ReactStyleVariation,
} from '@teleporthq/teleport-types'
import { performance } from 'perf_hooks'
import { ProjectPluginCSSModules } from '@teleporthq/teleport-project-plugin-css-modules'
import { ProjectPluginReactJSS } from '@teleporthq/teleport-project-plugin-react-jss'
import { ProjectPluginTailwind } from '@teleporthq/teleport-project-plugin-tailwind'
import { ProjectPluginStyledComponents } from '@teleporthq/teleport-project-plugin-styled-components'
import reactProjectJSON from '../../../examples/uidl-samples/react-project.json'
import projectJSON from '../../../examples/uidl-samples/project.json'
import tailwindProjectJSON from '../../../examples/uidl-samples/project-tailwind.json'
import { ProjectPluginParseEmbed } from '@teleporthq/teleport-project-plugin-parse-embed'
import { ProjectPluginExternalEmbed } from '@teleporthq/teleport-project-plugin-external-embed'

const projectUIDL = projectJSON as unknown as ProjectUIDL
const reactProjectUIDL = reactProjectJSON as unknown as ProjectUIDL
const tailwindProjectUIDL = tailwindProjectJSON as unknown as ProjectUIDL
const assetFile = readFileSync(join(__dirname, 'asset.png'))
const base64File = Buffer.from(assetFile).toString('base64')
const packerOptions: PackerOptions = {
  publisher: PublisherType.DISK,
  projectType: ProjectType.REACT,
  publishOptions: {
    outputPath: 'dist',
  },
  assets: [
    {
      fileType: 'png',
      name: 'icons-192',
      content: base64File,
      path: ['custom'],
    },
    {
      fileType: 'png',
      name: 'icons-512',
      content: base64File,
      contentEncoding: 'base64',
    },
    {
      content: 'https://placekitten.com/800/400',
      name: 'kitten.png',
      location: 'remote',
      path: ['one', 'two'],
    },
    {
      content:
        'https://storage.googleapis.com/playground-bucket-v2.teleporthq.io/8db63146-c3cc-47b2-a38d-1f2b39418d4e/8f055b25-4689-4305-b41a-0655571542ca',
      name: 'super-funky.ttf',
      location: 'remote',
      path: ['fonts'],
    },
  ],
}

const log = async (cb: () => Promise<string>) => {
  const t1 = performance.now()
  const framework = await cb()
  const t2 = performance.now()

  const time = t2 - t1
  console.info(chalk.greenBright(`${framework} -  ${time.toFixed(2)}`))
}

const run = async () => {
  try {
    if (packerOptions.publisher === PublisherType.DISK) {
      rmdirSync('dist', { recursive: true })
      mkdirSync('dist')
    }

    let result

    // /* Plain Html Generator */
    // await log(async () => {
    //   result = await packProject(projectUIDL as unknown as ProjectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.HTML,
    //   })
    //   console.info(ProjectType.HTML, '-', result.payload)
    //   return ProjectType.HTML
    // })

    // /* Plain Html Generator with embed parser */
    // await log(async () => {
    //   result = await packProject(projectUIDL as unknown as ProjectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.HTML,
    //     plugins: [new ProjectPluginParseEmbed()],
    //     publishOptions: {
    //       ...packerOptions.publishOptions,
    //       projectSlug: `teleport-project-html-embeds`,
    //     },
    //   })
    //   console.info(ProjectType.HTML, '-', result.payload)
    //   return `${ProjectType.HTML} - Parse Embeds`
    // })

    /* Styled JSX */
    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NEXT,
        plugins: [new ProjectPluginParseEmbed()],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: `teleport-project-next-embeds`,
        },
      })
      console.info(ProjectType.NEXT, '-', result.payload)
      return `${ProjectType.NEXT} - Parse Embeds`
    })

    // /* Frameworks using Css-Modules */
    // await log(async () => {
    //   result = await packProject(projectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.NEXT,
    //     plugins: [new ProjectPluginCSSModules({ framework: ProjectType.NEXT })],
    //     publishOptions: {
    //       ...packerOptions.publishOptions,
    //       projectSlug: 'teleport-project-next-css-modules',
    //     },
    //   })
    //   console.info(ProjectType.NEXT + '-' + ReactStyleVariation.CSSModules, '-', result.payload)
    //   return `Next - CSSModules`
    // })

    // /* Frameworks use CSS */

    // await log(async () => {
    //   result = await packProject(projectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.REACT,
    //     plugins: [new ProjectPluginParseEmbed()],
    //   })
    //   console.info(ProjectType.REACT, '-', result.payload)
    //   return ProjectType.REACT
    // })

    // await log(async () => {
    //   result = await packProject(projectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.NUXT,
    //     plugins: [new ProjectPluginExternalEmbed()],
    //   })
    //   console.info(ProjectType.NUXT, '-', result.payload)
    //   return ProjectType.NUXT
    // })

    // await log(async () => {
    //   result = await packProject(projectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.VUE,
    //     plugins: [new ProjectPluginExternalEmbed()],
    //   })
    //   console.info(ProjectType.VUE, '-', result.payload)
    //   return ProjectType.VUE
    // })

    // await log(async () => {
    //   result = await packProject(projectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.ANGULAR,
    //     plugins: [new ProjectPluginExternalEmbed()],
    //   })
    //   console.info(ProjectType.ANGULAR, '-', result.payload)
    //   return ProjectType.ANGULAR
    // })

    // /* React JSS */
    // await log(async () => {
    //   result = await packProject(projectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.NEXT,
    //     plugins: [new ProjectPluginReactJSS({ framework: ProjectType.NEXT })],
    //     publishOptions: {
    //       ...packerOptions.publishOptions,
    //       projectSlug: 'teleport-project-next-react-jss',
    //     },
    //   })
    //   console.info(ProjectType.NEXT + '-' + ReactStyleVariation.ReactJSS, '-', result.payload)
    //   return `NEXT - React-JSS`
    // })

    // /* Styled Components */
    // await log(async () => {
    //   result = await packProject(reactProjectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.REACT,
    //     plugins: [new ProjectPluginStyledComponents({ framework: ProjectType.REACT })],
    //     publishOptions: {
    //       ...packerOptions.publishOptions,
    //       projectSlug: `teleport-project-react-styled-components`,
    //     },
    //   })
    //   return `React - StyledComponents`
    // })

    // await log(async () => {
    //   result = await packProject(projectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.NEXT,
    //     plugins: [new ProjectPluginStyledComponents({ framework: ProjectType.NEXT })],
    //     publishOptions: {
    //       ...packerOptions.publishOptions,
    //       projectSlug: 'teleport-project-next-styled-components',
    //     },
    //   })
    //   console.info(
    //     ProjectType.NEXT + '-' + ReactStyleVariation.StyledComponents,
    //     '-',
    //     result.payload
    //   )
    //   return `Next - StyledComponents`
    // })

    // /* Frameworks using default + tailwind ccss */

    // await log(async () => {
    //   result = await packProject(tailwindProjectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.NEXT,
    //     plugins: [
    //       new ProjectPluginTailwind({
    //         framework: ProjectType.NEXT,
    //       }),
    //     ],
    //     publishOptions: {
    //       ...packerOptions.publishOptions,
    //       projectSlug: 'teleport-project-next-tailwind',
    //     },
    //   })

    //   console.info(ProjectType.NEXT, '+' + 'tailwind', '-', result.payload)
    //   return `Next - Tailwind`
    // })

    // await log(async () => {
    //   result = await packProject(tailwindProjectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.REACT,
    //     plugins: [
    //       new ProjectPluginTailwind({
    //         framework: ProjectType.REACT,
    //       }),
    //     ],
    //     publishOptions: {
    //       ...packerOptions.publishOptions,
    //       projectSlug: 'teleport-project-react-tailwind',
    //     },
    //   })

    //   console.info(ProjectType.REACT, '+' + 'tailwind', '-', result.payload)
    //   return `React - Tailwind`
    // })

    // await log(async () => {
    //   result = await packProject(tailwindProjectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.VUE,
    //     plugins: [
    //       new ProjectPluginExternalEmbed(),
    //       new ProjectPluginTailwind({
    //         framework: ProjectType.VUE,
    //       }),
    //     ],
    //     publishOptions: {
    //       ...packerOptions.publishOptions,
    //       projectSlug: 'teleport-project-vue-tailwind',
    //     },
    //   })

    //   console.info(ProjectType.VUE, '+' + 'tailwind', '-', result.payload)
    //   return `VUE - Tailwind`
    // })

    // await log(async () => {
    //   result = await packProject(tailwindProjectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.ANGULAR,
    //     plugins: [
    //       new ProjectPluginExternalEmbed(),
    //       new ProjectPluginTailwind({
    //         framework: ProjectType.ANGULAR,
    //       }),
    //     ],
    //     publishOptions: {
    //       ...packerOptions.publishOptions,
    //       projectSlug: 'teleport-project-angular-tailwind',
    //     },
    //   })

    //   console.info(ProjectType.ANGULAR, '+' + 'tailwind', '-', result.payload)
    //   return `Angular - Tailwind`
    // })

    // await log(async () => {
    //   result = await packProject(tailwindProjectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.NUXT,
    //     plugins: [
    //       new ProjectPluginExternalEmbed(),
    //       new ProjectPluginTailwind({
    //         framework: ProjectType.NUXT,
    //       }),
    //     ],
    //     publishOptions: {
    //       ...packerOptions.publishOptions,
    //       projectSlug: 'teleport-project-nuxt-tailwind',
    //     },
    //   })

    //   console.info(ProjectType.NUXT, '+' + 'tailwind', '-', result.payload)
    //   return `Nuxt - Tailwind`
    // })

    // await log(async () => {
    //   result = await packProject(tailwindProjectUIDL, {
    //     ...packerOptions,
    //     projectType: ProjectType.HTML,
    //     plugins: [
    //       new ProjectPluginParseEmbed(),
    //       new ProjectPluginTailwind({
    //         framework: ProjectType.HTML,
    //         path: [''],
    //       }),
    //     ],
    //     publishOptions: {
    //       ...packerOptions.publishOptions,
    //       projectSlug: 'teleport-project-html-tailwind',
    //     },
    //   })

    //   console.info(ProjectType.HTML, '+' + 'tailwind', '-', result.payload)
    //   return `Html - Tailwind`
    // })
  } catch (e) {
    console.info(e)
  }
}

run()
