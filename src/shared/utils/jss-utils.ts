import preset from 'jss-preset-default'
import jss from 'jss'
import { StyleDefinitions } from '../../typings/uidl-definitions'

jss.setup(preset())

export const createCSSClass = (className: string, styleObject: StyleDefinitions) => {
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
