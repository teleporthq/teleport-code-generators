import jss from 'jss'
import preset from 'jss-preset-default'

jss.setup(preset())

export const createCSSClass = (className: string, styleObject: Record<string, string | number>) => {
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
