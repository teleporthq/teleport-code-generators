import path from 'path'
import chalk from 'chalk'
import { writeFileSync } from 'fs-extra'
import { ComponentType } from '@teleporthq/teleport-types'
import { DEFAULT_CONFIG_FILE_NAME, DefaultConfigTemplate, UUDID_REGEX } from './constants'
import { findFileByName } from './services/file'

export const updateConfigFile = (
  fn: (content: DefaultConfigTemplate) => void,
  customPath?: string
) => {
  const fileContent = findFileByName(DEFAULT_CONFIG_FILE_NAME)
  if (!fileContent) {
    return
  }
  const content = JSON.parse(fileContent) as DefaultConfigTemplate
  fn(content)
  writeFileSync(
    customPath || path.join(process.cwd(), DEFAULT_CONFIG_FILE_NAME),
    JSON.stringify(content, null, 2)
  )
}

export const getComponentType = (): ComponentType => {
  const packageJSON = JSON.parse(findFileByName(`package.json`)) as Record<
    string,
    Record<string, unknown>
  >
  if (!packageJSON) {
    console.warn(chalk.yellow(`Please run the command inside a project that contains package.json`))
    return
  }
  return findFlavourByDependencies(
    Object.keys(
      {
        ...packageJSON.dependencies,
        ...packageJSON.devDependencies,
      } || {}
    )
  )
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
    default: {
      console.warn(chalk.yellow(`Failed in detecting project type, fallback to React`))
      return ComponentType.REACT
    }
  }
}
