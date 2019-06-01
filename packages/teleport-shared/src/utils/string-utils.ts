export const camelCaseToDashCase = (str: string): string =>
  str.replace(/([a-zA-Z])(?=[A-Z])/g, '$1-').toLowerCase()

export const dashCaseToCamelCase = (str: string): string =>
  str.replace(/[-_]+(.)?/g, (_, chr) => (chr ? chr.toUpperCase() : ''))

export const capitalize = (str: string): string => str[0].toUpperCase() + str.slice(1)

export const dashCaseToUpperCamelCase = (str: string) => capitalize(dashCaseToCamelCase(str))

// Replaces all ocurrences of non alpha-numeric characters in the string (except _)
export const sanitizeVariableName = (str: string): string => str.replace(/\W/g, '')

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

export const addSpacesToEachLine = (spaces: string, str: string) => {
  // indent the first line
  const respaced = spaces + str
  // add indent to all the other lines
  return respaced.replace(/\n/g, `\n${spaces}`)
}

export const removeLastEmptyLine = (str: string) => {
  return str.replace(/\n$/g, '')
}
