import * as types from '@babel/types'

export const createElementTag = (tagName: string, childTags?: string, t = types) => {
  return `<${tagName}>${childTags}</${tagName}>`
}
