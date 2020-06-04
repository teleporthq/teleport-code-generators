import { createProjectPacker } from '@teleporthq/teleport-project-packer'

import { createReactProjectGenerator } from '@teleporthq/teleport-project-generator-react'
import { createNextProjectGenerator } from '@teleporthq/teleport-project-generator-next'
import { createVueProjectGenerator } from '@teleporthq/teleport-project-generator-vue'
import { createNuxtProjectGenerator } from '@teleporthq/teleport-project-generator-nuxt'
import { createPreactProjectGenerator } from '@teleporthq/teleport-project-generator-preact'
import { createStencilProjectGenerator } from '@teleporthq/teleport-project-generator-stencil'
import { createAngularProjectGenerator } from '@teleporthq/teleport-project-generator-angular'
import { createReactNativeProjectGenerator } from '@teleporthq/teleport-project-generator-reactnative'
import { createGridsomeProjectGenerator } from '@teleporthq/teleport-project-generator-gridsome'
import { createGatsbyProjectGenerator } from '@teleporthq/teleport-project-generator-gatsby'

import { createDiskPublisher } from '@teleporthq/teleport-publisher-disk'
import {
  RemoteTemplateDefinition,
  ProjectUIDL,
  ProjectGenerator,
  ReactStyleVariation,
} from '@teleporthq/teleport-types'

import config from '../config.json'

import {
  GITHUB_TEMPLATE_OWNER,
  REACT_GITHUB_PROJECT,
  REACTNATIVE_GITHUB_PROJECT,
  NEXT_GITHUB_PROJECT,
  VUE_GITHUB_PROJECT,
  NUXT_GITHUB_PROJECT,
  PREACT_GITHUB_PROJECT,
  STENCIL_GITHUB_PROJECT,
  ANGULAR_GITHUB_PROJECT,
  PREACT_CODESANDBOX_PROJECT,
  GRIDSOME_GITHUB_PROJECT,
  GATSBY_GITHUB_PROJECT,
} from './constants'

import projectUIDL from '../../../examples/uidl-samples/project.json'

const generators: Record<string, ProjectGenerator> = {
  react: createReactProjectGenerator(),
  next: createNextProjectGenerator(),
  vue: createVueProjectGenerator(),
  nuxt: createNuxtProjectGenerator(),
  preact: createPreactProjectGenerator(),
  stencil: createStencilProjectGenerator(),
  angular: createAngularProjectGenerator(),
  reactnative: createReactNativeProjectGenerator(),
  preactCodesandbox: createPreactProjectGenerator(),
  gridsome: createGridsomeProjectGenerator(),
  gatsby: createGatsbyProjectGenerator(),
  gatsbyStyledComponents: createGatsbyProjectGenerator({
    variation: ReactStyleVariation.StyledComponents,
  }),
}

const getGithubRemoteDefinition = (username: string, repo: string): RemoteTemplateDefinition => {
  return { username, repo, provider: 'github' }
}

const templates: Record<string, RemoteTemplateDefinition> = {
  react: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, REACT_GITHUB_PROJECT),
  reactnative: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, REACTNATIVE_GITHUB_PROJECT),
  next: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, NEXT_GITHUB_PROJECT),
  vue: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, VUE_GITHUB_PROJECT),
  nuxt: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, NUXT_GITHUB_PROJECT),
  preact: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, PREACT_GITHUB_PROJECT),
  stencil: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, STENCIL_GITHUB_PROJECT),
  angular: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, ANGULAR_GITHUB_PROJECT),
  preactCodesandbox: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, PREACT_CODESANDBOX_PROJECT),
  gridsome: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, GRIDSOME_GITHUB_PROJECT),
  gatsby: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, GATSBY_GITHUB_PROJECT),
  gatsbyStyledComponents: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, GATSBY_GITHUB_PROJECT),
}

const publisher = createDiskPublisher({
  outputPath: 'dist',
})

const packProject = async (projectType: string) => {
  const remoteTemplate = templates[projectType] as RemoteTemplateDefinition

  remoteTemplate.auth = {
    token: config.token,
  }

  const packer = createProjectPacker()
  packer.setPublisher(publisher)
  packer.setGenerator(generators[projectType])
  await packer.loadRemoteTemplate(remoteTemplate)

  const result = await packer.pack((projectUIDL as unknown) as ProjectUIDL)

  console.info(projectType, ' - ', result)
}

const run = async () => {
  try {
    await packProject('react')
    // await packProject('reactnative')
    await packProject('next')
    await packProject('vue')
    await packProject('nuxt')
    await packProject('preact')
    await packProject('stencil')
    await packProject('angular')
    await packProject('preactCodesandbox')
    await packProject('gridsome')
    await packProject('gatsbyStyledComponents')
  } catch (e) {
    console.info(e)
  }
}

run()
