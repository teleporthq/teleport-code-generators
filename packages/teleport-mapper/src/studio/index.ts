// @ts-nocheck
import {
  UIDLAttributeValue,
  UIDLGlobalProjectValues,
  UIDLPropDefinition,
  UIDLStateValueDetails,
  UIDLStaticValue,
  VComponentUIDL,
  VProjectUIDL,
  VUIDLElementNode,
  VUIDLStyleSetDefnition,
} from '@teleporthq/teleport-types'
import { orderEntities, computeCustomPropertyName } from './utils'
import { getResetStylesheet, getProjectGlobalStylesheet } from './constants'
import { ProjectSnapshot } from './types'

export interface MapSnapshowToUIDLInterface {
  generatePageMetaData: (pageId: string) => UIDLStateValueDetails
  nodeToUIDL: (
    nodeId: string,
    compId: string,
    parentNode?: VUIDLElementNode
  ) => VUIDLElementNode | null
  stylesToUIDL: (nodeId: string) => Record<string, VUIDLStyleSetDefnition>
  componentToUIDL: (compId: string) => VComponentUIDL | null
  pageToUIDL: (pageId: string) => VComponentUIDL | null
  toProjectUIDL: (snapshot: Record<string, unknown>) => VProjectUIDL
}

export class MapSnapshotToUIDL implements MapSnapshowToUIDLInterface {
  snapshot: ProjectSnapshot

  constructor(snapshot: Record<string, unknown>) {
    this.snapshot = (snapshot as unknown) as ProjectSnapshot
  }

  getDefaultStylesFromTokens() {
    const defaultBackgroundId = this.getTokenWithRole('background-color')?.id
    const defaultForegroundId = this.getTokenWithRole('foreground-color')?.id
    const variablesMapping = this.getTokensAsCustomProperties()
    const textStyle = this.getDefaultTextStyle()

    const { content } = textStyle

    return {
      ...(defaultForegroundId
        ? { color: `var(${variablesMapping[defaultForegroundId].name})` }
        : null),
      ...(defaultBackgroundId
        ? { background: `var(${variablesMapping[defaultBackgroundId].name})` }
        : null),
      ...Object.keys(content || {}).reduce((acc: Record<string, string | number>, key: string) => {
        if (content[key]?.type === 'static') {
          acc[key] = (content[key] as unknown).content
        }
        return acc
      }, {}),
    }
  }

  generatePageMetaData(pageId: string) {
    const { byId: pagesById } = this.snapshot.pages
    const { byId: assetsById } = this.snapshot.assets

    const page = pagesById[pageId]
    const pageSettings = page?.settings
    const projectSettings = this.snapshot?.settings || {}

    if (!page) {
      throw new Error(`Page ${pageId} could not be found in project ${this.snapshot.title}`)
    }

    if (!pageSettings) {
      return { value: page.title }
    }

    const seoTitleFromProject = projectSettings.general?.title || this.snapshot.title
    const titlePlaceholder = page?.isHomePage
      ? seoTitleFromProject
      : page.title + ' - ' + seoTitleFromProject

    const projectImageAsset = projectSettings.social?.image
      ? assetsById[projectSettings.social?.image]
      : undefined
    const pageImageAsset = pageSettings.socialImage
      ? assetsById[pageSettings.socialImage]
      : undefined

    const metaTags = [
      {
        name: 'description',
        content: pageSettings.seoDescription || projectSettings.general?.description,
      },
      {
        property: 'og:title',
        content: pageSettings.socialTitle || pageSettings.seoTitle || titlePlaceholder,
      },
      {
        property: 'og:description',
        content:
          pageSettings.socialDescription ||
          projectSettings.social?.description ||
          pageSettings.seoDescription ||
          projectSettings.general?.description,
      },
      {
        property: 'og:image',
        content: pageImageAsset?.remoteSrc || projectImageAsset?.remoteSrc,
      },
    ]
    const filteredMetaTags = metaTags.filter((tag) => tag.content)

    const seo: Record<string, unknown> = {
      title: pageSettings.seoTitle || titlePlaceholder,
      metaTags: filteredMetaTags,
    }

    const stateDefinitions: UIDLStateValueDetails = { value: page.title, seo }
    Object.assign(
      stateDefinitions,
      pageSettings.url ? { pageOptions: { navLink: pageSettings.url } } : {}
    )

    return stateDefinitions
  }

  propsToUIDL(props: Record<string, unknown>): Record<string, UIDLPropDefinition> {
    if (!props) {
      return null
    }
    return Object.values(props).reduce((acc: Record<string, UIDLPropDefinition>, prop) => {
      acc[prop.name] = {
        type: prop.type,
        defaultValue: prop.defaultValue,
      }
      return acc
    }, {})
  }

  attrsToUIDL(attrs: Record<string, unknown>, compId: string) {
    if (!attrs) {
      return null
    }

    const { byId: componentsById } = this.snapshot.components
    const { byId: pagesById } = this.snapshot.pages

    const compProps = (componentsById[compId] || pagesById[compId])?.propDefinitions
    return Object.keys(attrs).reduce((acc: UIDLAttributeValue, attrId) => {
      const attr = attrs[attrId]
      if (attr.type === 'static') {
        acc[attrId] = ({
          type: 'static',
          content: String(attr.content),
        } as unknown) as UIDLStaticValue
      }

      if (attr.type === 'dynamic' && attr.content.referenceType === 'prop') {
        const usedProp = compProps[attr.content.id]
        if (usedProp) {
          acc[attrId] = {
            type: 'dynamic',
            content: {
              referenceType: 'prop',
              id: usedProp.name,
            },
          }
        }
      }

      return acc
    }, {})
  }

  stylesToUIDL(nodeId: string) {
    const styles = this.snapshot.nodes.byId[nodeId]?.styles || {}
    const { tokensById = {}, categoriesById = {} } = this.snapshot.designLanguage

    return Object.keys(styles || {}).reduce((acc: UIDLStaticValue, styleKey) => {
      const style = styles[styleKey]

      if (style.type === 'static' && style?.content) {
        acc[styleKey] = {
          type: 'static',
          content: style.content,
        }
      }

      if (style.type === 'dynamic' && style.content?.referenceType === 'token') {
        const usedToken = tokensById[style.content.id]
        acc[styleKey] = {
          type: 'dynamic',
          content: {
            referenceType: 'token',
            id: computeCustomPropertyName(usedToken, categoriesById),
          },
        }
      }

      return acc
    }, {})
  }

  nodeToUIDL(
    nodeId: string,
    compId: string,
    parentNode?: VUIDLElementNode
  ): VUIDLElementNode | null {
    const { byId: nodesById } = this.snapshot.nodes
    const { byId: componentsById } = this.snapshot.components
    const { byId: pagesById } = this.snapshot.pages

    const node = nodesById[nodeId]
    if (!node) {
      return null
    }

    const {
      primitiveType,
      attrs = {},
      semanticType,
      childrenIds = {},
      contentChildren = {},
      compIdOfCompInstance,
    } = node
    const style = this.stylesToUIDL(node.id)
    let elementNode: VUIDLElementNode = {
      type: 'element',
      content: {
        elementType: primitiveType,
        ...(semanticType && { semanticType }),
        ...(Object.keys(attrs || {}).length > 0 && {
          attrs: this.attrsToUIDL(attrs, compId),
        }),
        ...(Object.keys(style).length > 0 && { style }),
        children: [],
      },
    }

    if (primitiveType === 'component' && compIdOfCompInstance) {
      const usedComponent = componentsById[compIdOfCompInstance]
      elementNode = {
        ...elementNode,
        content: {
          ...elementNode.content,
          elementType: primitiveType,
          semanticType: usedComponent.title,
          dependency: {
            type: 'local',
          },
        },
      }

      if (parentNode?.type === 'element') {
        parentNode.content.children.push(elementNode)
      }

      return elementNode
    }

    Object.values(contentChildren).forEach((contentNode) => {
      if (contentNode.type === 'static' && contentNode?.content) {
        elementNode.content.children.push({
          type: 'static',
          content: contentNode.content,
        })
      }

      if (contentNode.type === 'dynamic' && contentNode.content.referenceType === 'prop') {
        const usedProp = (componentsById[compId] || pagesById[compId])?.propDefinitions[
          contentNode.content.id
        ]
        if (!usedProp) {
          return
        }
        elementNode.content.children.push({
          type: 'dynamic',
          content: {
            referenceType: 'prop',
            id: usedProp.name,
          },
        })
      }
    })

    Object.keys(childrenIds)
      .map((childId) => nodesById[childId])
      .sort(orderEntities)
      .forEach((childNode) => this.nodeToUIDL(childNode.id, compId, elementNode))

    if (parentNode?.type === 'element') {
      parentNode.content.children.push(elementNode)
    }

    return elementNode
  }

  componentToUIDL(compId: string): VComponentUIDL | null {
    const { byId: componentsById } = this.snapshot.components
    const comp = componentsById[compId]
    if (!comp) {
      throw new Error('Component missing from the project')
    }

    const { title, rootNodeId, propDefinitions: compProps } = comp
    const propDefinitions: Record<string, UIDLPropDefinition> = this.propsToUIDL(compProps)
    const component: VComponentUIDL = {
      name: title,
      propDefinitions,
      node: this.nodeToUIDL(rootNodeId, compId),
    }

    return component
  }

  pageToUIDL(pageId: string): VComponentUIDL {
    const usedPage = this.snapshot.pages.byId[pageId]
    if (!usedPage) {
      return
    }

    const { title, rootNodeId } = usedPage
    const page: VComponentUIDL = {
      name: title,
      node: this.nodeToUIDL(rootNodeId, pageId),
    }
    return page
  }

  styleSetDefinitionsToUIDL(): Record<string, VUIDLStyleSetDefnition> {
    const { designLanguage } = this.snapshot
    const { textStyleSetsById = {} } = designLanguage

    return Object.values(textStyleSetsById).reduce((acc, styleRef) => {
      acc[styleRef.id] = {
        id: styleRef.id,
        name: styleRef.name,
        type: 'reusable-project-style-map',
        content: Object.keys(styleRef.content).reduce((styleAcc, styleId) => {
          const style = styleRef.content[styleId]
          if (style.type === 'static') {
            styleAcc[styleId] = {
              type: 'static',
              content: style.content,
            }
          }
          return styleAcc
        }, {}),
      }
      return acc
    }, {})
  }

  toProjectUIDL() {
    const { components, pages } = this.snapshot
    const { byId: componentsById } = components
    const { byId: pagesById } = pages
    let uidl: VProjectUIDL = {}
    const homePage = Object.values(pagesById).find((page) => page.isHomePage)
    const tokens = Object.values(this.getTokensAsCustomProperties() || {}).reduce(
      (acc: Record<string, UIDLStaticValue>, tokenRef) => {
        acc[tokenRef.name] = {
          type: 'static',
          content: tokenRef.value,
        }
        return acc
      },
      {}
    )

    const uidlPages = Object.values(pagesById).map((page) => {
      const pageUIDL = this.pageToUIDL(page.id)
      pageUIDL.node.content.style.minHeight = { type: 'static', content: '100vh' }
      return {
        type: 'conditional',
        content: {
          node: pageUIDL.node,
          value: page.title,
          reference: {
            type: 'dynamic',
            content: {
              referenceType: 'state',
              id: 'route',
            },
          },
        },
      }
    })

    uidl = {
      globals: this.projectSettingsToUIDL(),
      name: this.snapshot.title,
      root: {
        name: 'App',
        styleSetDefinitions: this.styleSetDefinitionsToUIDL(),
        designLanguage: {
          tokens,
        },
        stateDefinitions: {
          route: {
            type: 'string',
            defaultValue: homePage?.title ?? 'index',
            values: Object.keys(pagesById).map((pageId) => this.generatePageMetaData(pageId)),
          },
        },
        node: {
          type: 'element',
          content: {
            elementType: 'Router',
            children: uidlPages,
          },
        },
      },
    }

    Object.values(componentsById || {}).forEach((comp) => {
      const component = this.componentToUIDL(comp.id)
      if (component) {
        uidl = {
          ...uidl,
          components: {
            ...uidl.components,
            [comp.title]: component,
          },
        }
      }
    })

    return uidl
  }

  projectSettingsToUIDL(): UIDLGlobalProjectValues {
    const { title, settings } = this.snapshot
    const { byId: fontsById } = this.snapshot.fonts
    const stylesFromTokens = this.getDefaultStylesFromTokens()

    const globals: UIDLGlobalProjectValues = {
      settings: {
        title: settings.general?.title || title,
        language: settings.general?.language || 'en',
      },
      assets: [
        {
          type: 'style',
          content: getResetStylesheet().split('\n').join(''),
        },
        {
          type: 'style',
          content: getProjectGlobalStylesheet(stylesFromTokens),
        },
      ],
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1.0',
        },
        {
          charSet: 'utf-8',
        },
        {
          property: 'twitter:card',
          content: 'summary_large_image',
        },
      ],
    }

    if (!settings) {
      return globals
    }

    // ASSETS

    // favicon
    if (settings.general?.favicon) {
      const faviconAsset = this.snapshot.assets.byId[settings.general?.favicon]

      if (faviconAsset) {
        globals.assets?.push({
          type: 'icon',
          path: faviconAsset.imageSrc,
          options: { iconType: 'icon/png', iconSizes: '32x32' },
        })
      }
    }

    // fonts
    Object.values(fontsById || {}).forEach((font) => {
      globals.assets?.push({
        type: 'font',
        path: font.path,
      })
    })

    // Google scripts
    if (settings.code?.googleAnalyticsId) {
      globals.assets?.push({
        type: 'script',
        path: `https://www.googletagmanager.com/gtag/js?id=${settings.code.googleAnalyticsId}`,
        options: {
          target: 'body',
          async: true,
        },
      })

      globals.assets?.push({
        type: 'script',
        content: `window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${settings.code.googleAnalyticsId}');`,
        options: {
          target: 'body',
        },
      })
    }

    if (settings.code?.tagManagerId) {
      globals.assets?.push({
        type: 'script',
        content: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
          new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
          j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
          'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
          })(window,document,'script','dataLayer','${settings.code.tagManagerId}');`,
        options: {
          target: 'body',
        },
      })
    }

    globals.customCode = {}

    if (settings.code?.headTag) {
      globals.customCode.head = settings.code.headTag
    }

    if (settings.code?.bodyTag) {
      globals.customCode.body = settings.code.bodyTag
    }

    return globals
  }

  private getTokenWithRole(role: string) {
    const { designLanguage } = this.snapshot
    return Object.values(designLanguage?.tokensById || {}).find((token) => token.role === role)
  }

  private getTokensAsCustomProperties() {
    const { tokensById = {}, categoriesById = {} } = this.snapshot.designLanguage
    return Object.keys(tokensById || {}).reduce(
      (acc: Record<string, Record<string, string>>, tokenId: string) => {
        acc[tokenId] = {
          name: computeCustomPropertyName(tokensById[tokenId], categoriesById),
          value: tokensById[tokenId].value,
        }
        return acc
      },
      {}
    )
  }

  private getDefaultTextStyle() {
    const {
      designLanguage: { textStyleSetsById = {} },
    } = this.snapshot
    return Object.values(textStyleSetsById).find((textStyle) => textStyle?.role === 'default')
  }
}
