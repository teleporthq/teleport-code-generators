// @ts-ignore
import componentInputJSON from './component-with-primitive-values.json'

import { parseProjectJSON } from '../../src/parser'
import { ensureUniqueResourceNames } from '../../src/parser/resource-names'
import { UIDLResourceItem } from '@teleporthq/teleport-types'

/**
 * Every resource is written to `resources/<name>` and imported under that
 * name. Two details pages over two REST API sources both had a fetcher named
 * `fetch_data_detail`, so one file overwrote the other: the first page fetched
 * the second page's records and answered every link with a 404.
 */

const resource = (name: string, dataSourceId: string): UIDLResourceItem => ({
  name,
  path: {
    baseUrl: { type: 'static', content: '/api/data-source' },
    route: { type: 'static', content: `/${dataSourceId}/data` },
  },
  params: { dataSourceId: { type: 'static', content: dataSourceId } },
})

const namesOf = (items: Record<string, UIDLResourceItem>) =>
  Object.keys(items).map((id) => [id, items[id].name])

describe('ensureUniqueResourceNames', () => {
  it('gives every later resource sharing a name a numbered one', () => {
    const items = ensureUniqueResourceNames({
      categoriesDetail: resource('fetch_data_detail', 'categories'),
      templatesDetail: resource('fetch_data_detail', 'templates'),
      blogDetail: resource('fetch_data_detail', 'blog'),
    })

    expect(namesOf(items)).toEqual([
      ['categoriesDetail', 'fetch_data_detail'],
      ['templatesDetail', 'fetch_data_detail2'],
      ['blogDetail', 'fetch_data_detail3'],
    ])
    expect(items.templatesDetail.params).toEqual({
      dataSourceId: { type: 'static', content: 'templates' },
    })
  })

  it('treats names that land on the same module as the same name', () => {
    const items = ensureUniqueResourceNames({
      snake: resource('fetch_data_detail', 'categories'),
      camel: resource('fetchDataDetail', 'templates'),
    })

    expect(namesOf(items)).toEqual([
      ['snake', 'fetch_data_detail'],
      ['camel', 'fetchDataDetail2'],
    ])
  })

  it('never takes a name another resource already has', () => {
    const items = ensureUniqueResourceNames({
      first: resource('fetch_data_detail', 'categories'),
      second: resource('fetch_data_detail', 'templates'),
      numbered: resource('fetch_data_detail2', 'blog'),
    })

    expect(namesOf(items)).toEqual([
      ['first', 'fetch_data_detail'],
      ['second', 'fetch_data_detail3'],
      ['numbered', 'fetch_data_detail2'],
    ])
  })

  it('leaves a project whose names are all distinct as it was', () => {
    const items = {
      categoriesDetail: resource('fetch_categories_detail', 'categories'),
      categoriesPaths: resource('fetch_categories_paths', 'categories'),
    }

    const result = ensureUniqueResourceNames(items)

    expect(result.categoriesDetail).toBe(items.categoriesDetail)
    expect(result.categoriesPaths).toBe(items.categoriesPaths)
  })
})

describe('parseProjectJSON', () => {
  it('hands the generators resources with distinct names', () => {
    const input = {
      root: componentInputJSON,
      resources: {
        items: {
          categoriesDetail: resource('fetch_data_detail', 'categories'),
          templatesDetail: resource('fetch_data_detail', 'templates'),
        },
      },
    }

    const { resources } = parseProjectJSON(input)

    expect(namesOf(resources.items)).toEqual([
      ['categoriesDetail', 'fetch_data_detail'],
      ['templatesDetail', 'fetch_data_detail2'],
    ])
    expect(input.resources.items.templatesDetail.name).toBe('fetch_data_detail')
  })
})
