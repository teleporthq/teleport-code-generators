export const camelCaseToDashCase = (str: string): string =>
  str.replace(/([a-z])(?=[A-Z])|([A-Z0-9])(?=[A-Z][a-z])/g, '$1$2-').toLowerCase()
export const dashCaseToCamelCase = (str: string): string =>
  str.replace(/[-_]+(.)?/g, (_, chr) => (chr ? chr.toUpperCase() : ''))

export const capitalize = (str: string): string => str[0].toUpperCase() + str.slice(1)
export const camelize = (str: string): string => str[0].toLowerCase() + str.slice(1)

export const dashCaseToUpperCamelCase = (str: string) => capitalize(dashCaseToCamelCase(str))

export const removeIllegalCharacters = (str: string) => {
  if (typeof str !== 'string') {
    return null
  }

  return str
    .replace(/[^a-zA-Z0-9-_]/g, '') // Remove all non-alphanumeric characters except _ and -
    .replace(/^[0-9-_]*/, '') // Remove leading numbers
    .replace(/\-\-+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, '') // Trim - from end of text
}

export const slugify = (str: string): string => {
  if (str == null) {
    return null // Check for undefined or null
  }

  return str
    .toLowerCase()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w\-]+/g, '') // Remove all non-word chars
    .replace(/\-\-+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, '') // Trim - from end of text
    .replace(/&/g, '-and-') // Replace & with 'and'
}

export const createStateOrPropStoringValue = (value: string) => camelize(dashCaseToCamelCase(value))
export const createStateStoringFunction = (value: string) =>
  `set${capitalize(dashCaseToUpperCamelCase(value))}`

export const addSpacesToEachLine = (spaces: string, str: string) => {
  // indent the first line
  const respaced = spaces + str
  // add indent to all the other lines
  return respaced.replace(/\n/g, `\n${spaces}`)
}

export const removeLastEmptyLine = (str: string) => {
  return str.replace(/\n$/g, '')
}

const encodingMap: Record<string, string> = {
  '&': '&amp;',
  '>': '&gt;',
  '<': '&lt;',
  '"': '&quot;',
  '{': '&#123;',
  '}': '&#125;',
  "'": '&apos;',
}

export const encode = (str: string) => {
  return str
    .split('')
    .map((char) => {
      const encodedChar = encodingMap[char]
      return encodedChar ? encodedChar : char
    })
    .join('')
}

export const generateRandomString = () => Math.random().toString(36).substring(2, 6)

export const generateCSSVariableName = (name: string): string => {
  return name.startsWith('--') ? camelCaseToDashCase(name) : camelCaseToDashCase(`--${name}`)
}
