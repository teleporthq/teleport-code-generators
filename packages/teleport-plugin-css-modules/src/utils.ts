import { StyleUtils } from '@teleporthq/teleport-plugin-common'
import { UIDLUtils } from '@teleporthq/teleport-shared'
import { UIDLStyleSheetContent, UIDLStyleValue } from '@teleporthq/teleport-types'

export const generateStyledFromStyleContent = (
  styles: Record<string, UIDLStyleSheetContent> | Record<string, UIDLStyleValue> = {}
): Record<string, string | number> => {
  const { staticStyles, tokenStyles } = UIDLUtils.splitDynamicAndStaticStyles(styles)

  const collectedStyles = {
    ...StyleUtils.getContentOfStyleObject(staticStyles),
    ...StyleUtils.getCSSVariablesContentFromTokenStyles(tokenStyles),
  } as Record<string, string | number>

  return collectedStyles
}
