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
import pluginGatsbyStyledComponents from '@teleporthq/teleport-project-plugin-gatsby-styled-components'
import pluginNextStyledComponents from '@teleporthq/teleport-project-plugin-next-styled-components'
import pluginNextReactJSS from '@teleporthq/teleport-project-plugin-next-react-jss'
import pluginNextReactCSSModules from '@teleporthq/teleport-project-plugin-next-css-modules'
import pluginReactStyledComponents from '@teleporthq/teleport-project-plugin-react-styled-components'
import reactProjectJSON from '../../../examples/uidl-samples/react-project.json'
import projectJSON from '../../../examples/uidl-samples/project.json'

const projectUIDL = projectJSON as unknown as ProjectUIDL
const reactProjectUIDL = reactProjectJSON as unknown as ProjectUIDL
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
      rmdirSync('dist', { recursive: true })
      mkdirSync('dist')
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
        plugins: [pluginNextReactCSSModules],
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
      result = await packProject(projectUIDL, { ...packerOptions, projectType: ProjectType.VUE })
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
        plugins: [pluginNextReactJSS],
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
        plugins: [pluginReactStyledComponents],
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
        plugins: [pluginGatsbyStyledComponents],
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
        plugins: [pluginNextStyledComponents],
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
  } catch (e) {
    console.info(e)
  }
}

run()
