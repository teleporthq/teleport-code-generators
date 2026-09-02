import { GeneratedFolder, ProjectUIDL, UIDLElementNode } from '@teleporthq/teleport-types'
import uidlSample from '../../../examples/test-samples/project-sample.json'
import { createNextProjectGenerator } from '../src'
import NextTemplate from '../src/project-template'
import {
  LIST_CHROME_ATTR,
  LIST_CONTROLS_ELEMENT_TYPE,
  PAGINATION_ATTR,
  PAGINATION_ELEMENT_TYPE,
} from '../src/pagination-scroll/constants'

const template = JSON.parse(JSON.stringify(NextTemplate)) as GeneratedFolder

/**
 * The shape the GUI writes under a paginated array mapper: the search / sort
 * block above the rows, and the previous/next block below them. Both are
 * siblings of the mapper's rows, which is what the runtime relies on.
 */
const LIST_CONTROLS: UIDLElementNode = {
  type: 'element',
  content: {
    elementType: LIST_CONTROLS_ELEMENT_TYPE,
    semanticType: 'div',
    children: [],
  },
}

const PAGINATION_BLOCK: UIDLElementNode = {
  type: 'element',
  content: {
    elementType: PAGINATION_ELEMENT_TYPE,
    semanticType: 'div',
    children: [
      {
        type: 'element',
        content: {
          elementType: 'cms-navigation-button',
          semanticType: 'div',
          name: 'ThqPreviousElm',
          children: [{ type: 'static', content: 'Previous' }],
        },
      },
      {
        type: 'element',
        content: {
          elementType: 'cms-navigation-button',
          semanticType: 'div',
          name: 'ThqNextElm',
          children: [{ type: 'static', content: 'Next' }],
        },
      },
    ],
  },
}

const buildUidl = (withPagination: boolean): ProjectUIDL => {
  const uidl = JSON.parse(JSON.stringify(uidlSample)) as ProjectUIDL
  if (!withPagination) {
    return uidl
  }

  const indexPage = (uidl.root.node.content.children || []).find(
    (child) =>
      child.type === 'conditional' && (child.content as { value?: string }).value === 'index'
  )
  const pageElement = (indexPage as { content: { node: { content: { children: unknown[] } } } })
    .content.node.content

  pageElement.children.push(JSON.parse(JSON.stringify(LIST_CONTROLS)))
  pageElement.children.push(JSON.parse(JSON.stringify(PAGINATION_BLOCK)))

  return uidl
}

const findAppFile = (outputFolder: GeneratedFolder) =>
  outputFolder.subFolders
    .find((sub) => sub.name === 'pages')
    ?.files.find((file) => file.name === '_app')

const findRuntimeFile = (outputFolder: GeneratedFolder) =>
  outputFolder.subFolders
    .find((sub) => sub.name === 'utils')
    ?.files.find((file) => file.name === 'pagination-scroll')

const findIndexPage = (outputFolder: GeneratedFolder) =>
  outputFolder.subFolders
    .find((sub) => sub.name === 'pages')
    ?.files.find((file) => file.name === 'index')

describe('Next generator with a paginated array mapper', () => {
  const generator = createNextProjectGenerator()

  it('marks the pagination block and its controls, and ships the runtime', async () => {
    const outputFolder = await generator.generateProject(buildUidl(true), template)

    // Both markers have to reach the emitted JSX: the runtime delegates off the
    // first and tells rows from chrome with the second.
    const indexPage = findIndexPage(outputFolder)
    expect(indexPage?.content).toContain(`${PAGINATION_ATTR}="true"`)
    expect(indexPage?.content).toContain(`${LIST_CHROME_ATTR}="true"`)

    const runtimeFile = findRuntimeFile(outputFolder)
    expect(runtimeFile).toBeDefined()
    expect(runtimeFile?.content).toContain(PAGINATION_ATTR)
    expect(runtimeFile?.content).toContain(LIST_CHROME_ATTR)

    expect(findAppFile(outputFolder)?.content).toContain("import '../utils/pagination-scroll'")

    // No npm dependency is involved.
    const packageFile = outputFolder.files.find((file) => file.name === 'package')
    const packageJson = JSON.parse(packageFile?.content || '{}')
    expect(
      Object.keys(packageJson.dependencies || {}).some((name) => name.includes('scroll'))
    ).toBe(false)
  })

  it('ships nothing for a project without a pagination block', async () => {
    const outputFolder = await generator.generateProject(buildUidl(false), template)

    expect(findRuntimeFile(outputFolder)).toBeUndefined()
    expect(findAppFile(outputFolder)?.content ?? '').not.toContain('utils/pagination-scroll')
    // The chrome marker is only worth its bytes next to a pagination block.
    expect(findIndexPage(outputFolder)?.content ?? '').not.toContain(LIST_CHROME_ATTR)
  })
})
