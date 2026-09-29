import { ProjectUIDL } from '@teleporthq/teleport-types'

// FNV-1a, 32 bits: the generators also run in the browser, where Node's
// crypto module is not available.
const fnv1a = (input: string, seed: number): number => {
  // tslint:disable-next-line:no-bitwise
  let hash = seed >>> 0
  for (let index = 0; index < input.length; index++) {
    // tslint:disable-next-line:no-bitwise
    hash ^= input.charCodeAt(index)
    // tslint:disable-next-line:no-bitwise
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash
}

/**
 * The worker's version: a hash of the whole project. The browser installs a
 * new worker only when the file's bytes change, and every cache is named after
 * this value — so the same project published twice keeps its caches, and any
 * change retires every cache of the previous version when the new worker
 * takes over.
 */
export const computeWorkerVersion = (uidl: ProjectUIDL): string => {
  const source = JSON.stringify(uidl)
  return fnv1a(source, 0x811c9dc5).toString(36) + fnv1a(source, 0x5bd1e995).toString(36)
}
