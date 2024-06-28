import { succeed, fail, Decoder } from '@mojotech/json-type-validation'

/* These are some custom combinators that comes in handy for us,
instead of parsing and cross-checking regex again. The combinators,
can used inside a existing Decoder, since we did not implement any run()
runWithException() etc */

export const isValidComponentName = (name: string): Decoder<string> => {
  const componentNameRegex = new RegExp('^[A-Z]+[a-zA-Z0-9]*$')
  if (name && typeof name === 'string' && componentNameRegex.test(name)) {
    return succeed(name)
  }

  return fail(`Invalid Component name, got ${name}`)
}

export const isValidNavLink = (link: string): Decoder<string> => {
  if (!link || typeof link !== 'string') {
    throw new Error(`Invalid navLink attribute, received ${link}`)
  }

  if (link === '**') {
    return succeed(link)
  }

  const navLinkRegex = new RegExp('/(?:[a-zA-Z0-9-_]+|/[[a-zA-Z]+]|[/[a-zA-Z]+])*')
  if (navLinkRegex.test(link)) {
    return succeed(link)
  }

  return fail(`Invalid navLink attribute, received ${link}`)
}

export const isValidFileName = (name: string): Decoder<string> => {
  const fileNameRegex = new RegExp('^[[a-zA-Z0-9-_.]+]*$')
  if (name && typeof name === 'string' && fileNameRegex.test(name)) {
    return succeed(name)
  }

  return fail(`Invalid File name, received ${name}`)
}

export const isValidElementName = (name: string): Decoder<string> => {
  const elementNameRefex = new RegExp('^[a-zA-Z]+[a-zA-Z0-9-_]*$')
  if (name && typeof name === 'string' && elementNameRefex.test(name)) {
    return succeed(name)
  }

  return fail(`Invalid name attribute, received ${name}`)
}
