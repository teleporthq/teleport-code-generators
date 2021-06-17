export interface ProjectSnapshot {
  title: string
  settings: Record<string, unknown>
  tokens: Record<string, unknown>
  stats: Record<string, unknown>
  fonts: Record<string, unknown>
  pages: Record<string, unknown>
  nodes: Record<string, unknown>
  components: Record<string, unknown>
  folders: Record<string, unknown>
  assets: Record<string, unknown>
  designLanguage: {
    tokensById: Record<string, unknown>
    categoriesById: Record<string, unknown>
    textStyleSetsById: Record<string, unknown>
  }
  collaborators: Record<string, unknown>
  isPublic: boolean
}
