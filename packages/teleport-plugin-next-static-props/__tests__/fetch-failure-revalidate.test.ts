import generator from '@babel/generator'
import * as types from '@babel/types'
import { ComponentStructure } from '@teleporthq/teleport-types'
import { createStaticPropsPlugin } from '../src/index'

/*
  A details page answers 404 both when its row does not exist and when the
  fetch for it FAILED. The failure is not a fact about the row: a timeout or a
  rate limit — every details page calls its source while the site is built —
  must not leave the record unreachable until the next deploy. Next.js caches a
  `notFound` that carries no `revalidate` for good, so the failure branch
  carries the same window as every other branch.
*/

const RESOURCE_ID = 'fetch-template-detail'

const makeStructure = (revalidate?: number): ComponentStructure =>
  ({
    uidl: {
      name: 'TemplateDetails',
      node: { type: 'element', content: { elementType: 'container' } },
      outputOptions: {
        pageId: 'page-template-details',
        folderPath: ['templates'],
        fileName: '[slug]',
        initialPropsData: {
          exposeAs: { name: 'template', valuePath: ['data', '0'] },
          resource: { id: RESOURCE_ID, params: {} },
          ...(revalidate ? { cache: { revalidate } } : {}),
        },
      },
    },
    chunks: [],
    dependencies: {},
    options: {
      skipI18n: true,
      resources: {
        items: { [RESOURCE_ID]: { id: RESOURCE_ID, name: 'template-detail' } },
        path: ['utils', 'data-sources'],
      },
    },
  } as unknown as ComponentStructure)

const catchBranchCode = async (structure: ComponentStructure): Promise<string> => {
  const result = await createStaticPropsPlugin()(structure)
  const chunk = result.chunks.find((c) => c.name === 'getStaticProps')
  const declaration = (chunk?.content as types.ExportNamedDeclaration)
    .declaration as types.FunctionDeclaration
  const tryStatement = declaration.body.body.find(
    (statement): statement is types.TryStatement => statement.type === 'TryStatement'
  )
  return generator(tryStatement?.handler as types.Node).code
}

describe('teleport-plugin-next-static-props: a failed fetch', () => {
  it('answers 404 with the page revalidate window, so the next request retries', async () => {
    const code = await catchBranchCode(makeStructure(60))

    expect(code).toContain('notFound: true')
    expect(code).toContain('revalidate: 60')
  })

  it('carries no revalidate when the page has no window', async () => {
    const code = await catchBranchCode(makeStructure())

    expect(code).toContain('notFound: true')
    expect(code).not.toContain('revalidate')
  })
})
