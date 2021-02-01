export interface PackageJSON {
  name: string
  description: string
  version: string
  main?: string
  author?: string
  license?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: unknown
}
