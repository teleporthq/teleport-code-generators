export const createHTMLNode = (tagName: string): any => {
  return {
    type: 'element',
    tagName,
    properties: {},
    children: [],
  }
}

export const addBooleanAttributeToNode = (node: any, key: string) => {
  node.properties[key] = true
}

export const addAttributeToNode = (node: any, key: string, value: string) => {
  node.properties[key] = value
}

export const addClassToNode = (node: any, className: string) => {
  node.properties.class = className
}

export const addChildNode = (node: any, child: any) => {
  node.children.push(child)
}

export const addTextNode = (node: any, text: string) => {
  node.children.push({
    type: 'text',
    value: text,
  })
}
