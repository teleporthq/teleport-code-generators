import { mkdirSync, rmdirSync } from 'fs'
import chalk from 'chalk'
import { packProject } from '@teleporthq/teleport-code-generator'
import { PackerOptions, ProjectType, ProjectUIDL, PublisherType } from '@teleporthq/teleport-types'
import { performance } from 'perf_hooks'
import contentfulUIDL from '../../../examples/uidl-samples/contentful.json'
import strapiUIDL from '../../../examples/uidl-samples/strapi.json'
import wordpressUIDL from '../../../examples/uidl-samples/wordpress.json'
import caisyUIDL from '../../../examples/uidl-samples/caisy.json'
import flotiqUIDL from '../../../examples/uidl-samples/flotiq.json'

const packerOptions: PackerOptions = {
  publisher: PublisherType.DISK,
  projectType: ProjectType.REACT,
  publishOptions: {
    outputPath: 'dist',
  },
  assets: [],
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
      try {
        rmdirSync('dist', { recursive: true })
        mkdirSync('dist')
      } catch /* tslint:disable no-empty */ {}
    }

    let result

    /* CMS uidl */
    await log(async () => {
      result = await packProject(contentfulUIDL as ProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NEXT,
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-contentful-cms',
        },
      })
      console.info(ProjectType.NEXT, '-', result.payload)
      return 'teleport-project-contentful-cms'
    })

    await log(async () => {
      result = await packProject(wordpressUIDL as ProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NEXT,
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-wordpress-cms',
        },
      })
      console.info(ProjectType.NEXT, '-', result.payload)
      return 'teleport-project-wordpress-cms'
    })

    await log(async () => {
      result = await packProject(strapiUIDL as ProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NEXT,
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-strapi-cms',
        },
      })
      console.info(ProjectType.NEXT, '-', result.payload)
      return 'teleport-project-strapi-cms'
    })

    await log(async () => {
      result = await packProject(caisyUIDL as ProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NEXT,
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-caisy-cms',
        },
      })
      console.info(ProjectType.NEXT, '-', result.payload)
      return 'teleport-project-caisy-cms'
    })

    await log(async () => {
      result = await packProject(flotiqUIDL as ProjectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NEXT,
        publishOptions: {
          ...packerOptions.publishOptions,
          projectSlug: 'teleport-project-flotiq-cms',
        },
      })
      console.info(ProjectType.NEXT, '-', result.payload)
      return 'teleport-project-flotiq-cms'
    })
  } catch (e) {
    console.info(e)
  }
}

run()
