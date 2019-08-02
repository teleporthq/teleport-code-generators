import projectPacker from '@teleporthq/teleport-project-packer'

import reactGenerator from '@teleporthq/teleport-project-generator-react'
import nextGenerator from '@teleporthq/teleport-project-generator-next'
import vueGenerator from '@teleporthq/teleport-project-generator-vue'
import nuxtGenerator from '@teleporthq/teleport-project-generator-nuxt'
import preactGenerator from '@teleporthq/teleport-project-generator-preact'

import { createDiskPublisher } from '@teleporthq/teleport-publisher-disk'
import { ProjectUIDL, RemoteTemplateDefinition } from '@teleporthq/teleport-types'

import config from '../config.json'

import {
  GITHUB_TEMPLATE_OWNER,
  REACT_GITHUB_PROJECT,
  NEXT_GITHUB_PROJECT,
  VUE_GITHUB_PROJECT,
  NUXT_GITHUB_PROJECT,
  PREACT_GITHUB_PROJECT,
} from './constants'

import projectUIDL from '../../../examples/uidl-samples/project.json'

const generators = {
  react: reactGenerator,
  next: nextGenerator,
  vue: vueGenerator,
  nuxt: nuxtGenerator,
  preact: preactGenerator,
}

const getGithubRemoteDefinition = (username: string, repo: string): RemoteTemplateDefinition => {
  return { username, repo, provider: 'github' }
}

const templates = {
  react: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, REACT_GITHUB_PROJECT),
  next: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, NEXT_GITHUB_PROJECT),
  vue: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, VUE_GITHUB_PROJECT),
  nuxt: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, NUXT_GITHUB_PROJECT),
  preact: getGithubRemoteDefinition(GITHUB_TEMPLATE_OWNER, PREACT_GITHUB_PROJECT),
}

const publisher = createDiskPublisher({
  outputPath: 'dist',
})

const packProject = async (projectType: string) => {
  const remoteTemplate = templates[projectType] as RemoteTemplateDefinition

  remoteTemplate.auth = {
    token: config.token,
  }

  projectPacker.setPublisher(publisher)
  projectPacker.setGenerator(generators[projectType])
  await projectPacker.loadTemplate(remoteTemplate)

  const result = await projectPacker.pack(projectUIDL as ProjectUIDL)

  console.info(projectType, ' - ', result)
}

const run = async () => {
  try {
    await packProject('react')
    await packProject('next')
    await packProject('vue')
    await packProject('nuxt')
    await packProject('preact')
  } catch (e) {
    console.info(e)
  }
}

run()
