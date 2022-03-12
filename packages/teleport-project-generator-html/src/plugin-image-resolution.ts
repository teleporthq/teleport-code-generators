import { UIDLUtils } from '@teleporthq/teleport-shared'
import PathResolver from 'path-browserify'
import {
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLElement,
  UIDLPropDefinition,
  UIDLStateDefinition,
  UIDLStyleDefinitions,
} from '@teleporthq/teleport-types'
const { parse, join, relative, isAbsolute } = PathResolver

class ProjectPluginImageResolver implements ProjectPlugin {
  private relativePath: string

  async runBefore(structure: ProjectPluginStructure) {
    const { uidl, strategy } = structure
    const assetsPath = join(strategy.id, strategy.static.path.join('/'))
    const pagesPath = join(strategy.id, strategy.pages.path.join('/'))
    this.relativePath = relative(pagesPath, assetsPath)

    UIDLUtils.traverseElements(uidl.root.node, this.imageResolver)
    Object.values(uidl?.root?.styleSetDefinitions || {}).forEach((styleSet) => {
      this.resolveFromStyles(styleSet.content)
    })

    Object.values(uidl.components || {}).forEach((component) => {
      UIDLUtils.traverseElements(component.node, this.imageResolver)
      Object.values(component?.styleSetDefinitions || {}).forEach((styleSet) => {
        this.resolveFromStyles(styleSet.content)
      })
      this.resolvePropsAndStates(component.stateDefinitions)
      this.resolvePropsAndStates(component.propDefinitions)
    })

    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    return structure
  }

  private resolvePropsAndStates = (
    defs: Record<string, UIDLPropDefinition> | Record<string, UIDLStateDefinition>
  ) => {
    Object.keys(defs || {}).forEach((propKey) => {
      const propValue = defs[propKey]

      if (
        propValue.type === 'string' &&
        typeof propValue?.defaultValue === 'string' &&
        parse(propValue?.defaultValue as string).dir.startsWith('/')
      ) {
        defs[propKey] = {
          ...defs[propKey],
          defaultValue: join(this.relativePath, propValue.defaultValue),
        }
      }
    })
  }

  private resolveFromStyles = (style: UIDLStyleDefinitions) => {
    if (
      style?.backgroundImage?.type === 'static' &&
      typeof style?.backgroundImage?.content === 'string'
    ) {
      const bgImage = style.backgroundImage.content
      if (bgImage.includes('http')) {
        return
      }

      const regex = /(?:\(['"]?)(.*?)(?:['"]?\))/
      const matches = regex.exec(bgImage)

      if (matches && matches?.length > 0 && isAbsolute(matches[1])) {
        style.backgroundImage.content = `url("${join(this.relativePath, matches[1])}")`
      }
    }
  }

  private imageResolver = (element: UIDLElement) => {
    this.resolveFromStyles(element?.style || {})

    Object.values(element?.referencedStyles || {}).forEach((styleRef) => {
      if (styleRef.content.mapType === 'inlined') {
        this.resolveFromStyles(styleRef.content.styles)
      }
    })

    if (
      element?.elementType === 'image' &&
      element.attrs?.src?.type === 'static' &&
      typeof element.attrs.src.content === 'string' &&
      isAbsolute(element.attrs.src.content) &&
      !element.attrs.src.content.startsWith('http')
    ) {
      element.attrs.src.content = join(this.relativePath, element.attrs.src.content)
    }

    if (element.elementType === 'component') {
      Object.keys(element?.attrs || {}).forEach((attrKey) => {
        const attrValue = element?.attrs[attrKey]
        if (
          attrValue.type === 'static' &&
          typeof attrValue.content === 'string' &&
          !attrValue.content.startsWith('http')
        ) {
          const resolvedPath = parse(attrValue.content)
          if (resolvedPath.dir.startsWith('/')) {
            element.attrs[attrKey].content = join(this.relativePath, attrValue.content)
          }
        }
      })
    }
  }
}

export const pluginImageResolver = new ProjectPluginImageResolver()
