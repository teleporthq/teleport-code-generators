import { createProjectPacker } from '@teleporthq/teleport-project-packer'

import { createReactProjectGenerator } from '@teleporthq/teleport-project-generator-react'
import { createNextProjectGenerator } from '@teleporthq/teleport-project-generator-next'
import { createVueProjectGenerator } from '@teleporthq/teleport-project-generator-vue'
import { createNuxtProjectGenerator } from '@teleporthq/teleport-project-generator-nuxt'
import { createAngularProjectGenerator } from '@teleporthq/teleport-project-generator-angular'
import { createDiskPublisher } from '@teleporthq/teleport-publisher-disk'
import { RemoteTemplateDefinition, ProjectUIDL, ProjectGenerator } from '@teleporthq/teleport-types'

import config from '../config.json'

import {
  GITHUB_TEMPLATE_OWNER,
  REACT_GITHUB_PROJECT,
  NEXT_GITHUB_PROJECT,
  VUE_GITHUB_PROJECT,
  NUXT_GITHUB_PROJECT,
  ANGULAR_GITHUB_PROJECT,
} from './constants'

import projectUIDL from '../../../examples/uidl-samples/project.json'

const generators: Record<string, ProjectGenerator> = {
  react: createReactProjectGenerator(),
  next: createNextProjectGenerator(),
  vue: createVueProjectGenerator(),
  nuxt: createNuxtProjectGenerator(),
  angular: createAngularProjectGenerator(),
}

const getGithubRemoteDefinition = (username: string, repo: string): RemoteTemplateDefinition => {
  return { username, repo, provider: 'github' }
}

const templates: Record<string, RemoteTemplateDefinition> = {
  react: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, REACT_GITHUB_PROJECT),
  next: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, NEXT_GITHUB_PROJECT),
  vue: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, VUE_GITHUB_PROJECT),
  nuxt: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, NUXT_GITHUB_PROJECT),
  angular: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, ANGULAR_GITHUB_PROJECT),
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

  const result = await packer.pack(projectUIDL as unknown as ProjectUIDL)

  console.info(projectType, ' - ', result)
}

const run = async () => {
  try {
    await packProject('react')
    await packProject('next')
    await packProject('vue')
    await packProject('nuxt')
    await packProject('angular')
  } catch (e) {
    console.info(e)
  }
}

run()
