import path from 'path'
import chalk from 'chalk'
import { writeFileSync } from 'fs-extra'
import { ComponentType } from '@teleporthq/teleport-types'
import { DefaultConfigTemplate, UUDID_REGEX, CONFIG_FILE } from './constants'
import { findFileByName } from './services/file'

export const updateConfigFile = (
  fn: (content: DefaultConfigTemplate) => void,
  customPath?: string
) => {
  const content = getConfigFile()
  fn(content)
  writeFileSync(
    customPath || path.join(process.cwd(), CONFIG_FILE),
    JSON.stringify(content, null, 2)
  )
}

const getConfigFile = () => {
  const fileContent = findFileByName(CONFIG_FILE)
  if (!fileContent) {
    return
  }
  return JSON.parse(fileContent) as DefaultConfigTemplate
}

export const getComponentType = (): ComponentType => {
  const config = getConfigFile()
  const packageJSON = getPackageJSON()

  return (
    config?.componentType ||
    findFlavourByDependencies(
      Object.keys(
        {
          ...((packageJSON?.dependencies as unknown as Record<string, string>) || {}),
          ...((packageJSON?.devDependencies as unknown as Record<string, string>) || {}),
        } || {}
      )
    )
  )
}

export const getPackageJSON = (): Record<
  string,
  Record<string, unknown> | string | number
> | null => {
  const json = findFileByName(`package.json`)
  if (!json) {
    console.warn(chalk.yellow(`Please run the command inside a project that contains package.json`))
    return null
  }
  return JSON.parse(json) as Record<string, Record<string, unknown | string | number>>
}

export const extractCompIdsFromURls = (components: string[]) =>
  components.reduce((acc: Record<string, string>, comp: string) => {
    const slug = comp.split('/')[4] || null
    const compId = comp.match(UUDID_REGEX)[0]
    if (slug && compId) {
      acc[compId] = slug
    }
    return acc
  }, {})

export const findFlavourByDependencies = (deps: string[]): ComponentType => {
  switch (true) {
    case deps.includes('react'):
      return ComponentType.REACT
    case deps.includes('@angular/core'):
      return ComponentType.ANGULAR
    case deps.includes('@stencil/core'):
      return ComponentType.STENCIL
    case deps.includes('vue'):
      return ComponentType.VUE
    case deps.includes('preact'):
      return ComponentType.PREACT
    case deps.includes('nuxt'):
      return ComponentType.VUE
    default: {
      console.warn(chalk.yellow(`Failed in detecting project type, fallback to React`))
      return ComponentType.REACT
    }
  }
}
