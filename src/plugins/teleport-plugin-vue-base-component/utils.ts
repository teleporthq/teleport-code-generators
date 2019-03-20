import * as types from '@babel/types'
import { PropDefinition, ComponentUIDL } from '../../uidl-definitions/types'
import { createHTMLNode, addTextNode, addChildNode } from '../../shared/utils/html-utils'
import { objectToObjectExpression } from '../../shared/utils/ast-js-utils'

export const generateVueComponentJS = (
  uidl: ComponentUIDL,
  componentDependencies: string[],
  dataObject: Record<string, any>,
  t = types
) => {
  const vueObjectProperties = []

  if (uidl.propDefinitions) {
    const props = generateVueComponentPropTypes(uidl.propDefinitions)
    const propsAST = objectToObjectExpression(props)
    vueObjectProperties.push(t.objectProperty(t.identifier('props'), propsAST))
  }

  if (componentDependencies.length) {
    const componentsAST = t.objectExpression([
      ...componentDependencies.map((declarationName) => {
        return t.objectProperty(
          t.identifier(declarationName),
          t.identifier(declarationName),
          false,
          true
        )
      }),
    ])
    vueObjectProperties.push(t.objectProperty(t.identifier('components'), componentsAST))
  }

  if (Object.keys(dataObject).length > 0) {
    const dataAST = objectToObjectExpression(dataObject)
    vueObjectProperties.push(
      t.objectMethod(
        'method',
        t.identifier('data'),
        [],
        t.blockStatement([t.returnStatement(dataAST)])
      )
    )
  }

  return t.exportDefaultDeclaration(
    t.objectExpression([
      t.objectProperty(t.identifier('name'), t.stringLiteral(uidl.name)),
      ...vueObjectProperties,
    ])
  )
}

const generateVueComponentPropTypes = (uidlPropDefinitions: Record<string, PropDefinition>) => {
  return Object.keys(uidlPropDefinitions).reduce((acc: { [key: string]: any }, name) => {
    let mappedType
    const { type, defaultValue } = uidlPropDefinitions[name]
    switch (type) {
      case 'string':
        mappedType = String
        break
      case 'number':
        mappedType = Number
        break
      case 'boolean':
        mappedType = Boolean
        break
      case 'children': // children is converted to slot and should not be added to props
        return acc
      case 'array':
        mappedType = Array
        break
      default:
        mappedType = null
    }

    acc[name] = defaultValue ? { type: mappedType, default: defaultValue } : mappedType
    return acc
  }, {})
}

export const addTextNodeToTag = (tag: any, text: string) => {
  if (text.startsWith('$props.') && !text.endsWith('$props.')) {
    // For real time, when users are typing we need to make sure there's something after the dot (.)
    const propName = text.replace('$props.', '')
    if (propName === 'children') {
      const slot = createHTMLNode('slot')
      addChildNode(tag, slot)
    } else {
      addTextNode(tag, `{{${propName}}}`)
    }
  } else if (text === '$item' || text === '$index') {
    addTextNode(tag, `{{${text.slice(1)}}}`)
  } else {
    addTextNode(tag, text.toString())
  }
}
