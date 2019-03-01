import * as types from '@babel/types'

/**
 * It's the part between the {} of interfaces and types
 *
 * interface a { foo: stirng } has object type annotation "foo: stirng"
 */
interface AnnotationInput {
  [key: string]: string
}
export const generateObjectTypeAnnotation = (
  annotationKeyValuePairs: AnnotationInput,
  t = types
): types.ObjectTypeProperty[] => {
  return Object.keys(annotationKeyValuePairs).reduce((acc: any[], key) => {
    const value = annotationKeyValuePairs[key]
    acc.push(t.objectTypeProperty(t.identifier(key), t.genericTypeAnnotation(t.identifier(value))))
    return acc
  }, [])
}

export const generateReactPropsInterface = (
  interfaceName: string,
  propDefinitions: AnnotationInput,
  t = types
) => {
  const interfaceObjectTypeProperties = generateObjectTypeAnnotation(propDefinitions, t)
  const interfaceBody = t.objectTypeAnnotation(interfaceObjectTypeProperties)
  const interfaceAst = t.interfaceDeclaration(t.identifier(interfaceName), null, [], interfaceBody)

  return interfaceAst
}
