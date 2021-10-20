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

class ProjectPluginImageResolution implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    const { uidl } = structure

    UIDLUtils.traverseElements(uidl.root.node, this.imageResolver)

    Object.values(uidl.components || {}).forEach((component) => {
      UIDLUtils.traverseElements(component.node, this.imageResolver)
      Object.values(component?.styleSetDefinitions || {}).forEach((styleSet) => {
        this.resolveFromStyles(styleSet.content)
      })
      this.resolvePropsAndStates(component.stateDefinitions)
      this.resolvePropsAndStates(component.propDefinitions)
    })

    Object.values(uidl?.root?.styleSetDefinitions || {}).forEach((styleSet) => {
      this.resolveFromStyles(styleSet.content)
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
        propValue?.defaultValue &&
        typeof propValue?.defaultValue === 'string' &&
        PathResolver.parse(propValue?.defaultValue as string).dir.startsWith('/')
      ) {
        defs[propKey] = {
          ...defs[propKey],
          defaultValue: PathResolver.join('../../public', propValue.defaultValue),
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

      if (matches && matches?.length > 0 && PathResolver.isAbsolute(matches[1])) {
        style.backgroundImage.content = `url("${PathResolver.join('../../public', matches[1])}")`
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
      PathResolver.isAbsolute(element.attrs.src.content) &&
      !element.attrs.src.content.startsWith('http')
    ) {
      element.attrs.src.content = PathResolver.join('../../public', element.attrs.src.content)
    }

    if (element.elementType === 'component') {
      Object.keys(element?.attrs || {}).forEach((attrKey) => {
        const attrValue = element?.attrs[attrKey]
        if (
          attrValue.type === 'static' &&
          typeof attrValue.content === 'string' &&
          !attrValue.content.startsWith('http')
        ) {
          const resolvedPath = PathResolver.parse(attrValue.content)
          if (resolvedPath.dir.startsWith('/')) {
            element.attrs[attrKey].content = PathResolver.join('../../public', attrValue.content)
          }
        }
      })
    }
  }
}

export const pluginImageResolution = Object.freeze(new ProjectPluginImageResolution())
