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
