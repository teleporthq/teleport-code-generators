import { UIDLElementNode } from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'

import { NodeToLitHTML } from './types'
import { createElementTag } from './utils'

const generateElementNode: NodeToLitHTML<UIDLElementNode> = (node, params) => {
  const { dependencies } = params
  const { elementType, dependency, children } = node.content
  const tagName = elementType || 'component'

  if (dependency) {
    if (dependency.type !== 'local') {
      // library and package dependencies are assumed to be safe
      dependencies[tagName] = { ...dependency }
    } else {
      // local dependencies can be renamed based on their safety (eg: Header/header, Form/form)
      const safeImportName = StringUtils.dashCaseToUpperCamelCase(tagName)
      dependencies[safeImportName] = { ...dependency }
    }
  }

  let childTags: string = ''

  if (children && children.length > 0) {
    children.forEach((child) => {
      const childTag = generateNode(child, params)
      childTags = `${childTags} ${childTag}`
    })
  }

  const templateTag = createElementTag(tagName, childTags)
  return templateTag
}

export default generateElementNode

export const generateNode = (node: any, params: any) => {
  switch (node.type) {
    case 'static':
      return StringUtils.encode(node.content.toString())

    case 'dynamic':
      const ref = node.content.id
      return `${String('${this.')}${ref}}`

    case 'element':
      return generateElementNode(node, params)

    default:
      throw new Error(
        `generateNode encountered a node of unsupported type: ${JSON.stringify(node, null, 2)}`
      )
  }
}
