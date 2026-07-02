import { GeneratedFolder, ProjectUIDL } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

// The in-form upload field as the GUI export emits it — verified against the
// GUI's constants (apps/gui/app/constants/primitives/form-file-input.ts):
// FORM_FILE_INPUT_ELEMENT_TYPE = 'form-file-input-node' and
// FORM_FILE_INPUT_WRAPPER_PROP_BY_ATTR maps the editor `state` attr to the
// camelCase wrapper prop `stateKey` (the page state holding the PickedFile
// array), same convention as the other `*-node` widgets.
const FORM_FILE_INPUT_ELEMENT_NODE = {
  type: 'element',
  content: {
    elementType: 'form-file-input-node',
    name: 'primary-image-upload',
    attrs: {
      stateKey: { type: 'static', content: 'primaryImageFiles' },
      accept: { type: 'static', content: 'image/*' },
      multiple: { type: 'static', content: false },
      label: { type: 'static', content: 'Primary Image' },
    },
    children: [],
  },
}

const buildUidlWithFormFileInput = (): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content
  pageElement.children.push(FORM_FILE_INPUT_ELEMENT_NODE)
  return uidl
}

const findFile = (folder: GeneratedFolder, folderName: string, fileName: string) =>
  folder.subFolders
    .find((sub) => sub.name === folderName)
    ?.files.find((file) => file.name === fileName)

describe('Next generator with a form-file-input element', () => {
  const generator = createNextProjectGenerator()

  it('renders <TqFormFileInput> on the page and ships the local wrapper, dep-free', async () => {
    const outputFolder = await generator.generateProject(buildUidlWithFormFileInput(), template)

    // The page maps the node to the wrapper and imports it locally.
    const indexPage = findFile(outputFolder, 'pages', 'index')
    expect(indexPage?.content).toContain('<TqFormFileInput')
    expect(indexPage?.content).toContain("from '../components/tq-form-file-input'")
    expect(indexPage?.content).toContain('stateKey="primaryImageFiles"')
    expect(indexPage?.content).toContain('accept="image/*"')

    // The local wrapper component is emitted: pure DOM/FileReader, no library.
    const component = findFile(outputFolder, 'components', 'tq-form-file-input')
    expect(component?.content).toContain('const TqFormFileInput =')
    expect(component?.content).toContain('readAsDataURL')
    // Non-DOM props are swallowed by the destructuring — neither the canonical
    // stateKey prop nor a legacy `state` attr may leak through {...rest} onto
    // the root <div>.
    expect(component?.content).toMatch(/stateKey,\s*\n\s*state,/)

    // No npm dependency is added and react is NOT bumped by this widget.
    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    const templatePackage = JSON.parse(
      (NextTemplate.files.find((file) => file.name === 'package')?.content as string) || '{}'
    )
    expect(packageJson.dependencies.react).toBe(templatePackage.dependencies.react)
    expect(packageJson.dependencies['react-dom']).toBe(templatePackage.dependencies['react-dom'])
    // Only deps that other generators add for the sample itself may appear —
    // never a widget library.
    for (const widgetDep of [
      'qrcode',
      'jsbarcode',
      'signature_pad',
      '@simonwep/pickr',
      'emoji-picker-element',
      'framer-motion',
    ]) {
      expect(packageJson.dependencies[widgetDep]).toBeUndefined()
    }
  })

  it('does not ship the wrapper for projects without the element', async () => {
    const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
    const outputFolder = await generator.generateProject(uidl, template)
    expect(findFile(outputFolder, 'components', 'tq-form-file-input')).toBeUndefined()
  })
})
