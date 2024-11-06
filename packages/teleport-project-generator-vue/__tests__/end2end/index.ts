import fallbackUidlSample from '../../../../examples/uidl-samples/tests.json'
import uidlSampleWithDependencies from '../../../../examples/test-samples/project-sample-with-dependency.json'
import uidlSample from '../../../../examples/test-samples/project-sample.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import template from './template-definition.json'
import { createVueProjectGenerator } from '../../src'
import { FileType } from '@teleporthq/teleport-types'

describe('Vue Project Generator', () => {
  const generator = createVueProjectGenerator()

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(uidlSample, template)
    const assetsPath = generator.getAssetsPath()
    const srcFolder = outputFolder.subFolders[0]
    const viewsFolder = srcFolder.subFolders[1]
    const packageJSON = outputFolder.files[0]
    const componentsFolder = srcFolder.subFolders[0]
    const modalComponent = componentsFolder.files[2]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(viewsFolder.files.length).toBe(3)
    expect(packageJSON).toBeDefined()
    expect(packageJSON.name).toBe('package')
    expect(modalComponent.name).toBe('modal')
    expect(componentsFolder.files.length).toBe(4)
  })

  it('runs without crashing with supported syntax for external dependencies', async () => {
    const outputFolder = await generator.generateProject(uidlSampleWithDependencies, template)
    const assetsPath = generator.getAssetsPath()
    const srcFolder = outputFolder.subFolders[0]
    const viewsFolder = srcFolder.subFolders[1]
    const packageJSON = outputFolder.files[0]
    const componentsFolder = srcFolder.subFolders[0]
    const modalComponent = componentsFolder.files[2]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(viewsFolder.files.length).toBe(3)
    expect(packageJSON).toBeDefined()
    expect(packageJSON.name).toBe('package')

    /*
     * All external dependencies are imported whenver they are used,
     * but we don't have a first class support for vue external dependencies
     * Since we need to make some config changes whenever a external component
     * is used from vue and the generators are not there yet.
     *
     * For further details refer --> https://github.com/teleporthq/teleport-code-generators/pull/478
     */

    expect(packageJSON.content).toContain(`{
  "name": "myvueproject",
  "version": "1.0.0",
  "description": "Project generated based on a UIDL document",
  "dependencies": {
    "dangerous-html": "0.1.13",
    "antd": "4.5.4"
  }
}`)
    expect(modalComponent.name).toBe('modal')
    expect(componentsFolder.files.length).toBe(4)
    expect(modalComponent.content).toContain(`import { Button } from 'antd'`)
    expect(viewsFolder.files[0].content).toContain(`<app-modal></app-modal>`)
    expect(viewsFolder.files[0].content).toContain(`import AppModal from '../components/modal'`)
    expect(viewsFolder.files[0].content).toContain(`import DangerousHTML from 'dangerous-html/vue'`)
    /** Imports that are just inserted like css are added to router file by default  */
    expect(srcFolder.files[0].content).toContain(`import 'antd/dist/antd.css'`)
  })

  it('creates a default route if a page is marked as fallback', async () => {
    const { subFolders } = await generator.generateProject(fallbackUidlSample, template)
    const pages = subFolders.find((folder) => folder.name === 'src')
    const routesPage = pages?.files.find((file) => file.name === 'router')

    expect(routesPage).toBeDefined()
    expect(routesPage?.content).toContain(`path: '**'`)
  })

  it('creates a named slot for passing templates', async () => {
    const { subFolders } = await generator.generateProject(fallbackUidlSample, template)
    const srcFolder = subFolders.find((folder) => folder.name === 'src')
    const viewsFolder = srcFolder?.subFolders.find((folder) => folder.name === 'views')
    const componentsFolder = srcFolder?.subFolders.find((folder) => folder.name === 'components')
    const homeFile = viewsFolder?.files.find(
      (file) => file.name === 'home' && file.fileType === FileType.VUE
    )
    const heroFile = componentsFolder?.files.find(
      (file) => file.name === 'hero' && file.fileType === FileType.VUE
    )

    expect(homeFile?.content).toContain(`<template v-slot:namedSlot>`)
    expect(heroFile?.content).toContain(`<slot name="namedSlot">`)
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})
