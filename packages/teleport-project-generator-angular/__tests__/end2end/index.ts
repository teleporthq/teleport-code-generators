import { FileType } from '@teleporthq/teleport-types'
import fallbackPageSample from '../../../../examples/uidl-samples/tests.json'
import uidlSample from '../../../../examples/test-samples/project-sample-with-dependency.json'
import invalidUidlSample from '../../../../examples/test-samples/project-invalid-sample.json'
import uidlSampleWithJustTokens from '../../../../examples/test-samples/project-with-only-tokens.json'
import { createAngularProjectGenerator } from '../../src'
import template from './template-definition.json'

describe('Angular Project Generator', () => {
  const generator = createAngularProjectGenerator()

  it('runs without crashing', async () => {
    const outputFolder = await generator.generateProject(uidlSample, template)
    const assetsPath = generator.getAssetsPath()

    const packageJSON = outputFolder.files[0]
    const srcFolder = outputFolder.subFolders[0]
    const appFolder = srcFolder.subFolders[0]
    const pagesFolder = appFolder.subFolders[0]
    const componentsFolder = appFolder.subFolders[1]
    const modalComponent = componentsFolder.subFolders[2]
    const componentsModule = componentsFolder.files[0]

    expect(assetsPath).toBeDefined()
    expect(outputFolder.name).toBe(template.name)
    expect(outputFolder.files[0].name).toBe('package')
    expect(srcFolder.files[0].fileType).toBe(FileType.HTML)
    expect(srcFolder.files[0].content).toBeDefined()
    expect(appFolder.files[0].name).toBe('app.module')
    expect(appFolder.files[0].fileType).toBe(FileType.TS)
    expect(appFolder.files[0].content).toBeDefined()
    expect(componentsFolder.name).toBe('components')
    expect(componentsModule.name).toBe('components.module')
    expect(componentsFolder.files[0].content).toBeDefined()
    expect(componentsFolder.subFolders.length).toBeGreaterThan(0)
    expect(pagesFolder.name).toBe('pages')
    expect(pagesFolder.subFolders.length).toBeGreaterThan(0)

    /*
     * For angular by default we are adding all the external dependencies only in components module
     * Since we can import once in module and use in all places for angular unlike
     * other frameworks. External dependnecies don't have first class support in Angular yet in
     * code-generators
     *
     * Any local dependency is also imported only once in the components module and direclty
     * used in any other component
     *
     * Refer --> https://github.com/teleporthq/teleport-code-generators/pull/478
     */

    expect(componentsModule.content).toContain(`import { Button } from 'antd'`)
    expect(componentsModule.content)
      .toContain(`import { OneComponent } from './one-component/one-component.component'
import { ExpandableArea } from './expandable-area/expandable-area.component'
import { Modal } from './modal/modal.component'
import { ModalWindow } from './modal-window/modal-window.component'`)
    expect(modalComponent.files[0].content).toContain(
      `<modal-window (onClose)="isOpen = false" *ngIf="isOpen"></modal-window>`
    )
    expect(pagesFolder.subFolders[0].files[0].content).toContain(`<app-modal></app-modal>`)
    expect(pagesFolder.subFolders[0].files[0].content).toMatch(`<dangerous-html`)
    expect(pagesFolder.subFolders[0].files[0].content).toContain(
      `html="<blockquote class='twitter-tweet'>`
    )
    /*
     * Modal is used in home page but don't need to import since all components are packed
     * together as components module and imported at once in root module
     */
    expect(pagesFolder.subFolders[0].files[1].content).not.toContain(`import Modal`)
    expect(modalComponent.files[1].content).not.toContain(`import Modal`)
    expect(packageJSON.content).toContain(`"antd": "4.5.4"`)
    expect(packageJSON.content).toContain(`"dangerous-html": "0.1.13"`)
  })

  it('creates style sheet and adds to the webpack file', async () => {
    const result = await generator.generateProject(uidlSampleWithJustTokens, template)
    const styleSheet = result.subFolders[0].files.find(
      (file) => file.name === 'styles' && file.fileType === FileType.CSS
    )

    expect(styleSheet).toBeDefined()
    expect(styleSheet.content).toContain(`--greys-500: #595959`)
  })

  it('creates a default route if a page is marked as fallback', async () => {
    const { subFolders } = await generator.generateProject(fallbackPageSample, template)
    const appFolder = subFolders[0].subFolders.find((folder) => folder.name === 'app')
    const appModule = appFolder?.files.find(
      (file) => file.name === 'app.module' && file.fileType === FileType.TS
    )
    expect(appModule?.content).toContain(`path: '**'`)
  })

  it('creates named slots to passs template to components', async () => {
    const { subFolders } = await generator.generateProject(fallbackPageSample, template)
    const srcFolder = subFolders.find((folder) => folder.name === 'src')
    const appFolder = srcFolder?.subFolders.find((folder) => folder.name === 'app')
    const pagesFolder = appFolder?.subFolders.find((folder) => folder.name === 'pages')
    const componentsFolder = appFolder?.subFolders.find((folder) => folder.name === 'components')

    const homeFolder = pagesFolder?.subFolders.find((folder) => folder.name === 'home')
    const homePage = homeFolder?.files.find(
      (file) => file.name === 'home.component' && file.fileType === FileType.HTML
    )

    const heroFolder = componentsFolder?.subFolders.find((folder) => folder.name === 'hero')
    const heroComponent = heroFolder?.files.find(
      (file) => file.name === 'hero.component' && file.fileType === FileType.HTML
    )

    expect(homePage).toBeDefined()
    expect(heroComponent).toBeDefined()
    expect(homePage?.content).toContain(`<ng-template #namedSlot>`)
    expect(heroComponent?.content).toContain(
      `*ngTemplateOutlet=\"namedSlot ? namedSlot : defaultNamedSlot\"`
    )
  })

  it('throws error when invalid UIDL sample is used', async () => {
    const result = generator.generateProject(invalidUidlSample, template)

    await expect(result).rejects.toThrow(Error)
  })
})
