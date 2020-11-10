import { StringUtils } from '@teleporthq/teleport-shared'
import { UIDLStaticValue, UIDLStyleDefinitions, UIDLStyleValue } from '@teleporthq/teleport-types'

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

export const getTokensContentFromTokensObject = (tokens: Record<string, UIDLStaticValue>) => {
  return Object.keys(tokens || {}).reduce((acc: Record<string, string | number>, key) => {
    acc[StringUtils.generateCSSVariableName(key)] = tokens[key].content as string
    return acc
  }, {})
}

export const getCSSVariablesContentFromTokenStyles = (styleObject: UIDLStyleDefinitions) => {
  return Object.keys(styleObject || {}).reduce((acc: Record<string, string>, key) => {
    const style = styleObject[key]
    if (style.type === 'dynamic' && style.content.referenceType === 'token') {
      acc[key] = `var(${StringUtils.generateCSSVariableName(style.content.id)})`
    }
    return acc
  }, {})
}
