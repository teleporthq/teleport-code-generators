import cheerio from 'cheerio'

export const createXMLRoot = (
  tagName: string,
  options = { selfClosing: false }
): CheerioStatic => {
  const emptyDeclaration = options.selfClosing ? `<${tagName}/>` : `<${tagName}></${tagName}>`
  let result

  try {
    result = cheerio.load(emptyDeclaration, {
      xmlMode: true, // otherwise the .html returns a <html><body> thing
      decodeEntities: false, // otherwise we can't set objects like `{ 'text-danger': hasError }`
      // without having them escaped with &quote; and stuff
    })
  } catch (err) {
    result = cheerio.load(`<${tagName}></${tagName}>`, {
      xmlMode: true, // otherwise the .html returns a <html><body> thing
      decodeEntities: false, // otherwise we can't set objects like `{ 'text-danger': hasError }`
      // without having them escaped with &quote; and stuff
    })
  }

  return result
}

// The CheerioStatic is used for the top level XML reference which is then transformed into HTML
// The Cheerio instance is used for regular nodes as we build the DOM structure
export const createXMLNode = (tagName: string, options = { selfClosing: false }): Cheerio => {
  return createXMLRoot(tagName, options)(tagName)
}
