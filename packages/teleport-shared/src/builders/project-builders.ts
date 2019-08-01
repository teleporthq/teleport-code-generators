import { ComponentUIDL, ProjectUIDL, GlobalAsset, WebManifest } from '@teleporthq/teleport-types'

export const project = (
  name: string,
  root: ComponentUIDL,
  components: ComponentUIDL[],
  globals?: {
    settings: {
      title: string
      language: string
    }
    meta: Array<Record<string, string>>
    assets: GlobalAsset[]
    manifest?: WebManifest
    variables?: Record<string, string>
  }
): ProjectUIDL => {
  return {
    name,
    root,
    components: UIDLArrayToRecord(components),
    globals: globals || simpleProjectGlobals(),
  }
}

export const UIDLArrayToRecord = (array: ComponentUIDL[]): Record<string, ComponentUIDL> => {
  const record = {}
  array.forEach((element) => {
    record[element.name] = element
  })

  return record
}

export const simpleProjectGlobals = (title: string = 'My teleport project') => {
  return {
    settings: {
      title,
      language: 'en',
    },
    assets: [],
    meta: [],
  }
}

export const explicitProjectGlobals = (
  title: string,
  language: string,
  meta: Array<Record<string, string>>,
  assets: GlobalAsset[],
  manifest?: WebManifest
) => {
  return {
    settings: {
      title,
      language,
    },
    assets,
    meta,
    manifest,
  }
}

export const socialMediaMeta = (property: string, content: string) => {
  return {
    property,
    content,
  }
}

export const metaTag = (name: string, content: string) => {
  return {
    name,
    content,
  }
}

export const projectMeta = (meta: Array<Record<string, string>>) => {
  return meta
}

export const manifestIcon = (src: string, type: string, sizes: string) => {
  return {
    src,
    type,
    sizes,
  }
}

export const projectAssetPath = (type: string, path?: string, meta?: Record<string, string>) => {
  return {
    type,
    path,
    meta,
  }
}

export const projectAssetContent = (
  type: string,
  content?: string,
  meta?: Record<string, string>
) => {
  return {
    type,
    content,
    meta,
  }
}

export const projectAssets = (assets: GlobalAsset[]) => {
  return assets
}
