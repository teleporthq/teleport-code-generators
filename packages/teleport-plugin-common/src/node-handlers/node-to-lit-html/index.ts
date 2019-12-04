import { UIDLElementNode } from '@teleporthq/teleport-types'
import { StringUtils } from '@teleporthq/teleport-shared'

import { NodeToLitHTML } from './types'
import { createElementTag } from './utils'

const generateElementNode: NodeToLitHTML<UIDLElementNode> = (node, params) => {
  const { dependencies } = params
  const { elementType, dependency, children, attrs } = node.content
  const tagName = elementType || 'component'
  let attributes = ''

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

  if (attrs) {
    Object.keys(attrs).forEach((attribute) => {
      const { type, content } = attrs[attribute]
      if (type === 'static') {
        attributes = `${attributes} .${attribute}=${content}`
      }

      if (type === 'dynamic') {
        // @ts-ignore
        const { id } = content
        attributes = `${attributes} .${attribute}=${String('${this.')}${id}}`
      }
    })
  }

  const templateTag = createElementTag(tagName, childTags, attributes)
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

    case 'conditional':
      return generateConditionalNode(node, params)

    default:
      throw new Error(
        `generateNode encountered a node of unsupported type: ${JSON.stringify(node, null, 2)}`
      )
  }
}

const generateConditionalNode = (node: any, params: any) => {
  return ''
}
