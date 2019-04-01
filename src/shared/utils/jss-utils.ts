import preset from 'jss-preset-default'
import jss from 'jss'

jss.setup(preset())

const getContentOfStyleKey = (styleValue: UIDLNodeStyleValue) => {
  switch (styleValue.type) {
    case 'static':
      return styleValue.content
    case 'nested-style':
      return getContentOfStyleObject(styleValue.content)
    default:
      throw new Error(
        `getContentOfStyleKey received unsupported ${JSON.stringify(
          styleValue,
          null,
          2
        )} UIDLNodeStyleValue value`
      )
  }
}

const getContentOfStyleObject = (styleObject: UIDLStyleDefinitions) => {
  return Object.keys(styleObject).reduce((acc: Record<string, unknown>, key) => {
    acc[key] = getContentOfStyleKey(styleObject[key])
    return acc
  }, {})
}

export const createCSSClass = (className: string, styleObject: UIDLStyleDefinitions) => {
  return jss
    .createStyleSheet(
      {
        [`.${className}`]: getContentOfStyleObject(styleObject),
      },
      {
        generateClassName: () => className,
      }
    )
    .toString()
}

export const createCSSClassFromStringMap = (
  className: string,
  styleObject: Record<string, string | number>
) => {
  return jss
    .createStyleSheet(
      {
        [`.${className}`]: styleObject,
      },
      {
        generateClassName: () => className,
      }
    )
    .toString()
}
