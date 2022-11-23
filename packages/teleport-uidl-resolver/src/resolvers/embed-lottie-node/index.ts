import { ComponentUIDL, GeneratorOptions } from '@teleporthq/teleport-types'
import { wrapHtmlLottieNode } from './utils'

export const resolveHtmlNode = (uidl: ComponentUIDL, options: GeneratorOptions) => {
  uidl.node = wrapHtmlLottieNode(uidl.node, options)
}
