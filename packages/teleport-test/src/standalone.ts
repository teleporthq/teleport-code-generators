// @ts-nocheck
import { mkdirSync, rmdirSync } from 'fs'
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
const packerOptions: PackerOptions = {
  publisher: PublisherType.DISK,
  projectType: ProjectType.REACT,
  publishOptions: {
    outputPath: 'dist',
  },
  assets: [
    {
      name: 'default-200h.png',
      content:
        'UklGRsYDAABXRUJQVlA4ILoDAAAQGwCdASrIAMgAPm02mEmmqy4nodcYUIANiWVu4XPr7VGsjMvV9KnKvm98nc4DzAP086QH8b9AHQA9AD+f/7frAPQA8rn9ofgS/aD9oPgA/Xv/8xYYwDsCSgcjJWK2zDEbCkkMJjbokxt0SY26JMbdEmNuiTG3RJjWiPmNTAeFJIYOlv5iZnm7SuD16zbo8mQZ2AXW10SYnrjzUvpuGMeH1x4DNdueJetTfFcDgTL5BkbtqOIrVreh48cAhnUutRtnDD5IQZbjla6JMbdEmNuiTG3RJjbokxt0SY26JMbdC4AA/v9ktxP3jX9whzjoAAAF/6lk/ND4T7oLALzJuEX4T/f+Hj04W+h0l+8jWSeI/FwTEJ5+aIM0hoV1gkxSnNETNiadNSfyzteMLbC55owkerwjBFXxYUnjLfogy0ENFTdMOtNsUOdd63g1y0EXWFsxJRzKA5Eul2Jt77sJ4/WYntvQsOv2m917k+SuoJrX4FafyzyjY0/aaj83+h64r7O4TmbSfh9sPntJkT0ZksLaOzNSiJkW6mSkcL2EfGRO64Vxs+cs7p2kZoijt1u9ck+OVF3fdQnnZ1s/kli50OxiaaGF8NphtvHSWFjeFUB5BZTWb5iEh99JYkF6HbiPidTb7pg7kvzYSa2UV+x0T0sKm4Nd0DRupeWT+4e3kHUjIvtfgnOU8H3chZQP3IM0BmASFQhwyvF227ctBI+Pxmb9ocd6T9irDUL3ngIYvoe0U79i5nc19USRU7aAF9FvNh/b2ZGjy2nW6bqcZPcEcNe9ROCfvQA3qePlwntzmqpVQhWFp3SbCa4WUPUiWHC/Viwkua9adx5bIEJ/jVMCtU2GadO3+92Jrbt3+BNU9ztbrUJt6qI9BjWhVtv2iyVKk6PJd0PNNZfM3oAjyj/1IcZjtTaDu6KFUpo4rPlhq2DaMD+N8+/J7I95VhfHoKD6PJh8sBeNzJp/SklTJYi0hw5Tx+34DobJxV/HMLXN+iAh2wFiaGNkL9/qoDjX8jx6kM+bsUnbB6pIzoVDtopcB8+o7AbVhs0dleewAh6l1QV5BMZ0iiuIOCo4TMEOLyWawv2hQ+fQs03RY0XAWcv1cLhB7/0kaa5LbjaNgoiVLEuoXW8l+lj4mPXn9sHJzXJke2diDkxF0QzSRyMf8a0UeKA+Oo/ltfCVZNoq91j/kd2A3ZxG1k8CIDEC88C8PndVmz3y1d9n2ilDWRWvyhLRbGeyFehjTXlSLKwhjA6udaeGMvF8FAAAAAAAAAA=',
      contentEncoding: 'base64',
      path: ['One', 'two'],
    },
    {
      name: 'default-avatar-200h.png',
      content:
        'UklGRuIIAABXRUJQVlA4WAoAAAAUAAAAxwAAxwAAQUxQSIMBAAABL0CQbePPvO3XiIg4dwfk2HbrNk8CuPcve5WAdMASmP77iY0HEJbkSSai/wzcto1Dben1E/w31vgCflpqXQAAAEzT0t8PPafx/LolZHghQbW9uke67Xh9tGIP4mFpdN/QCVbAsCsyP8lA/XoCG+Ow1ni9MmwTnKs8CocVOIxFsAsSFitvXHiWSMYj2AE1noF9nDFpnM51GFuYLnEa0ygM//CnrYXJ4jSmUZsFZ1WDqcUxJsE+TngskvL0PXB94VkidR7FHkhZeqyF5VLfwVgE+6DGMSocG8eKvZAwWI3DGOQtPJT5Qnio84XxYCgzw3vI+VDqi/9Bs7jgcCQePY/mMT7LxMOwx7v4LFl0H630sPps2N+Jl6Vg/iH51yRLZ1xrvJVhQ4FtLGso4w2Z4A/9Vu71FqSB3IhgC+hdhO4bId3JFEF1po7AlEYQmk3wsz5DgsRtIEVtgt/3JfqdnyFRgpnTXPq8o+ejeFtZTvKM5GQTrE+WvCtg2Gn1zHSuIZnZPAMAVlA4ICoCAABwGgCdASrIAMgAPm02l0gqrCqTPhw8QAbEtLd+PkyL4AGdnXXY32iPaXKgCHsnD3X9s6JWsXDPouGfRZKBs22/QZKnicOTOi3+gp5osrIVwOIx2RFEJDXz1t1yofE5ECdntVqM5NSDzYEGrRnRY7X5hJc2QqAxSf3qgQTPilOqPon3zBRJuy6n/QXePRQwhtidGCMjv+Z5/5mcUoHxNU9reVV1vOR/zsTBWAL/kMDFjeYMkgHo/5twhmK38um8OT6/NKtYOxEPjLn1Z94pfUWZ1RgD2q1g5gxQzRkAAP7xEAm+rQGQkCo4i1xNCo77EFIEPh1hXgGor2H5xWUf5TlOOsUd6qSCLpu6ogitdq/el0SIXr66Ac1mv9qqB0ncCeKfMGUkPnYAy/a0i0O2RK7kT5Rrbv/m0/838Yw6elkNRK+7ITaQndxA91qULLpPVwrazUcWIndD9pexirVJoAZB7zEqwOG3Yp3IlpK1bUi4clKcuZ2f7iYZ8T1nOfDmNHhaH75ypyCV4P3kdkFphImlCWmZc5YzmAJsY40/LZncoFR4WlAgwjITrmy0tRCV4bZqpUyLvelROm7InyQ3UNtwCvBuMYY//9Kr58TZyvEKg+xsVrFOvf9h99CMeV+prsbZbALA23z5/q6vhRs7oR8i0bel3igInm7fQNsnWA+NhjbzN2OXGoqAA7+yH5d1ekNDBMbRQtmwXZuhCtG17wQU8NtonXKRYAAAAFhNUCAGBQAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNS42LWMxNDUgNzkuMTYzNDk5LCAyMDE4LzA4LzEzLTE2OjQwOjIyICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgQ0MgMjAxOSAoV2luZG93cykiIHhtcDpDcmVhdGVEYXRlPSIyMDE5LTEwLTE1VDE4OjM5OjE0KzAzOjAwIiB4bXA6TW9kaWZ5RGF0ZT0iMjAxOS0xMC0xNVQxODo0MjowNiswMzowMCIgeG1wOk1ldGFkYXRhRGF0ZT0iMjAxOS0xMC0xNVQxODo0MjowNiswMzowMCIgZGM6Zm9ybWF0PSJpbWFnZS9wbmciIHBob3Rvc2hvcDpDb2xvck1vZGU9IjMiIHBob3Rvc2hvcDpJQ0NQcm9maWxlPSJzUkdCIElFQzYxOTY2LTIuMSIgeG1wTU06SW5zdGFuY2VJRD0ieG1wLmlpZDo2MTc4NjdjOS00NGRkLTZjNDAtOGQyYS1kMmFmMGQyYmEwMWYiIHhtcE1NOkRvY3VtZW50SUQ9InhtcC5kaWQ6NjE3ODY3YzktNDRkZC02YzQwLThkMmEtZDJhZjBkMmJhMDFmIiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InhtcC5kaWQ6NjE3ODY3YzktNDRkZC02YzQwLThkMmEtZDJhZjBkMmJhMDFmIj4gPHhtcE1NOkhpc3Rvcnk+IDxyZGY6U2VxPiA8cmRmOmxpIHN0RXZ0OmFjdGlvbj0iY3JlYXRlZCIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDo2MTc4NjdjOS00NGRkLTZjNDAtOGQyYS1kMmFmMGQyYmEwMWYiIHN0RXZ0OndoZW49IjIwMTktMTAtMTVUMTg6Mzk6MTQrMDM6MDAiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkFkb2JlIFBob3Rvc2hvcCBDQyAyMDE5IChXaW5kb3dzKSIvPiA8L3JkZjpTZXE+IDwveG1wTU06SGlzdG9yeT4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz4=',
      contentEncoding: 'base64',
      path: ['One'],
    },
    {
      name: '11075561-200h.png',
      content:
        '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',
      contentEncoding: 'base64',
      path: [],
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

    /* Plain Html Generator with embed parser */
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

    /* Frameworks using Css-Modules */

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

    /* Frameworks use CSS */

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.REACT,
        plugins: [new ProjectPluginParseEmbed()],
      })
      console.info(ProjectType.REACT, '-', result.payload)
      return ProjectType.REACT
    })

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.NUXT,
        plugins: [new ProjectPluginExternalEmbed()],
      })
      console.info(ProjectType.NUXT, '-', result.payload)
      return ProjectType.NUXT
    })

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.VUE,
        plugins: [new ProjectPluginExternalEmbed()],
      })
      console.info(ProjectType.VUE, '-', result.payload)
      return ProjectType.VUE
    })

    await log(async () => {
      result = await packProject(projectUIDL, {
        ...packerOptions,
        projectType: ProjectType.ANGULAR,
        plugins: [new ProjectPluginExternalEmbed()],
      })
      console.info(ProjectType.ANGULAR, '-', result.payload)
      return ProjectType.ANGULAR
    })

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
