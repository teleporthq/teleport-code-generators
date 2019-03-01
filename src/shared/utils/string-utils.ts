export const cammelCaseToDashCase = (name: string): string => {
  let ret = ''
  let prevLowercase = false

  for (const s of name) {
    const isUppercase = s.toUpperCase() === s
    if (isUppercase && prevLowercase) {
      ret += '-'
    }

    ret += s
    prevLowercase = !isUppercase
  }

  return ret.replace(/-+/g, '-').toLowerCase()
}

export const stringToCamelCase = (str: string): string =>
  str.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())

export const capitalize = (str: string): string => str[0].toUpperCase() + str.slice(1)

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

export const addSpacesToEachLine = (nbrOfspaces: number, str: string) => {
  const extraSpaces = ' '.repeat(nbrOfspaces)
  // indent the first line
  const respaced = extraSpaces + str
  // add indent to all the other lines
  return respaced.replace(/\n/g, `\n${extraSpaces}`)
}

export const removeLastEmptyLine = (str: string) => {
  return str.replace(/\n$/g, '')
}
