export interface FunctionSourcesEntry {
  output: string
  exportName: string
  target: 'ES5' | 'ES2017'
  sources: Array<{ file: string; names: string[] }>
}
export const MANIFEST: FunctionSourcesEntry[]
export function renderSources(entry: FunctionSourcesEntry): Array<[string, string]>
export function renderModule(entry: FunctionSourcesEntry): string
