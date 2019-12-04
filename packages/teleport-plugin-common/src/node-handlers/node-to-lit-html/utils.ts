import * as types from '@babel/types'

export const createElementTag = (
  tagName: string,
  childTags?: string,
  attributes?: string,
  t = types
) => {
  return `<${tagName} ${attributes}>
  ${childTags}
</${tagName}>`
}
