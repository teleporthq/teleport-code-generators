import { UIDLStyleDefinitions, UIDLStyleValue } from '@teleporthq/teleport-types'

const getContentOfStyleKey = (styleValue: UIDLStyleValue) => {
  if (styleValue.type === 'static') {
    return styleValue.content
  }
  throw new Error(
    `getContentOfStyleKey received unsupported ${JSON.stringify(
      styleValue,
      null,
      2
    )} UIDLNodeStyleValue value`
  )
}

export const getContentOfStyleObject = (styleObject: UIDLStyleDefinitions) => {
  return Object.keys(styleObject).reduce((acc: Record<string, unknown>, key) => {
    acc[key] = getContentOfStyleKey(styleObject[key])
    return acc
  }, {})
}
