// @ts-nocheck
import { readFileSync, mkdirSync, rmdirSync } from 'fs'
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
      // rmdirSync('dist', { recursive: true })
      // mkdirSync('dist')
    }

    let result

    /* Plain Html Generator */

    await log(async () => {
      result = await packProject(projectUIDL as unknown as ProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.HTML,
      })
      console.info(ProjectType.HTML, '-', result.payload)
      return ProjectType.HTML
    })

    /* Styled JSX */
    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NEXT,
      })
      console.info(ProjectType.NEXT, '-', result.payload)
      return ProjectType.NEXT
    })

    /* Frameworks using Css-Modules */

    await log(async () => {
      result = await packProject(reactProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.GATSBY,
      })
      console.info(ProjectType.GATSBY, '-', result.payload)
      return `Gatsy - CSSModules`
    })

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.PREACT,
      })
      console.info(ProjectType.PREACT, '-', result.payload)
      return ProjectType.PREACT
    })

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NEXT,
        plugins: [new ProjectPluginCSSModules({ framework: ProjectType.NEXT })],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-next-css-modules',
        },
      })
      console.info(ProjectType.NEXT + '-' + ReactStyleVariation.CSSModules, '-', result.payload)
      return `Next - CSSModules`
    })

    /* Frameworks use CSS */

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.REACT,
      })
      console.info(ProjectType.REACT, '-', result.payload)
      return ProjectType.REACT
    })

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.STENCIL,
      })
      console.info(ProjectType.STENCIL, '-', result.payload)
      return ProjectType.STENCIL
    })

    await log(async () => {
      result = await packProject(projectUIDL, { ...packerOptions, projectType: ProjectType.NUXT })
      console.info(ProjectType.NUXT, '-', result.payload)
      return ProjectType.NUXT
    })

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.VUE,
      })
      console.info(ProjectType.VUE, '-', result.payload)
      return ProjectType.VUE
    })

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.ANGULAR,
      })
      console.info(ProjectType.ANGULAR, '-', result.payload)
      return ProjectType.ANGULAR
    })

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.GRIDSOME,
      })
      console.info(ProjectType.GRIDSOME, '-', result.payload)
      return ProjectType.GRIDSOME
    })

    /* React JSS */
    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NEXT,
        plugins: [new ProjectPluginReactJSS({ framework: ProjectType.NEXT })],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-next-react-jss',
        },
      })
      console.info(ProjectType.NEXT + '-' + ReactStyleVariation.ReactJSS, '-', result.payload)
      return `NEXT - React-JSS`
    })

    /* Styled Components */
    await log(async () => {
      result = await packProject(reactProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.REACT,
        plugins: [new ProjectPluginStyledComponents({ framework: ProjectType.REACT })],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: `teleport-project-react-styled-components`,
        },
      })
      return `React - StyledComponents`
    })

    await log(async () => {
      result = await packProject(reactProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.GATSBY,
        plugins: [new ProjectPluginStyledComponents({ framework: ProjectType.GATSBY })],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-gatsby-styled-components',
        },
      })
      console.info(
        ProjectType.GATSBY + '-' + ReactStyleVariation.StyledComponents,
        '-',
        result.payload
      )
      return `Gatsby - StyledComponents`
    })

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NEXT,
        plugins: [new ProjectPluginStyledComponents({ framework: ProjectType.NEXT })],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-next-styled-components',
        },
      })
      console.info(
        ProjectType.NEXT + '-' + ReactStyleVariation.StyledComponents,
        '-',
        result.payload
      )
      return `Next - StyledComponents`
    })

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.REACTNATIVE,
      })
      console.info(ProjectType.REACTNATIVE, '-', result.payload)
      return ProjectType.REACTNATIVE
    })

    /* Frameworks using default + tailwind ccss */

    await log(async () => {
      result = await packProject(tailwindProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NEXT,
        plugins: [
          new ProjectPluginTailwind({
            framework: ProjectType.NEXT,
          }),
        ],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-next-tailwind',
        },
      })

      console.info(ProjectType.NEXT, '+' + 'tailwind', '-', result.payload)
      return `Next - Tailwind`
    })

    await log(async () => {
      result = await packProject(tailwindProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.REACT,
        plugins: [
          new ProjectPluginTailwind({
            framework: ProjectType.REACT,
          }),
        ],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-react-tailwind',
        },
      })

      console.info(ProjectType.REACT, '+' + 'tailwind', '-', result.payload)
      return `React - Tailwind`
    })

    await log(async () => {
      result = await packProject(tailwindProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.VUE,
        plugins: [
          new ProjectPluginTailwind({
            framework: ProjectType.VUE,
          }),
        ],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-vue-tailwind',
        },
      })

      console.info(ProjectType.VUE, '+' + 'tailwind', '-', result.payload)
      return `VUE - Tailwind`
    })

    await log(async () => {
      result = await packProject(tailwindProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.ANGULAR,
        plugins: [
          new ProjectPluginTailwind({
            framework: ProjectType.ANGULAR,
          }),
        ],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-angular-tailwind',
        },
      })

      console.info(ProjectType.ANGULAR, '+' + 'tailwind', '-', result.payload)
      return `Angular - Tailwind`
    })

    await log(async () => {
      result = await packProject(tailwindProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NUXT,
        plugins: [
          new ProjectPluginTailwind({
            framework: ProjectType.NUXT,
          }),
        ],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-nuxt-tailwind',
        },
      })

      console.info(ProjectType.NUXT, '+' + 'tailwind', '-', result.payload)
      return `Nuxt - Tailwind`
    })

    await log(async () => {
      result = await packProject(tailwindProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.HTML,
        plugins: [
          new ProjectPluginTailwind({
            framework: ProjectType.HTML,
            path: [''],
          }),
        ],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-html-tailwind',
        },
      })

      console.info(ProjectType.HTML, '+' + 'tailwind', '-', result.payload)
      return `Html - Tailwind`
    })

    await log(async () => {
      result = await packProject(tailwindProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.PREACT,
        plugins: [
          new ProjectPluginTailwind({
            framework: ProjectType.PREACT,
          }),
        ],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-preact-tailwind',
        },
      })

      console.info(ProjectType.PREACT, '+' + 'tailwind', '-', result.payload)
      return `Preact - Tailwind`
    })

    await log(async () => {
      result = await packProject(tailwindProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.STENCIL,
        plugins: [
          new ProjectPluginTailwind({
            framework: ProjectType.STENCIL,
            path: [''],
          }),
        ],
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-stencil-tailwind',
        },
      })

      console.info(ProjectType.STENCIL, '+' + 'tailwind', '-', result.payload)
      return `Stencil - Tailwind`
    })
  } catch (e) {
    console.info(e)
  }
}

run()
