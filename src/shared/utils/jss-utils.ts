import preset from 'jss-preset-default'
import jss from 'jss'

jss.setup(preset())

export const createCSSClass = (className: string, styleObject: UIDLStyleDefinitions) => {
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
