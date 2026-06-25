import { ProjectPluginStructure } from '@teleporthq/teleport-types'

/**
 * Several dependencies in the published Next template declare React-17-only peer
 * ranges that are stricter than what the libraries actually need at runtime —
 * most notably `dangerous-html` (peerOptional `react@^17.x`, used for raw-HTML
 * embeds) and `react-beautiful-dnd` (via the kanban widget). When a widget bumps
 * react/react-dom to ^18 (motion, calendar, kanban), npm 7+'s strict peer
 * resolution fails the install (ERESOLVE) even though those libraries run fine
 * under React 18. Emitting an `.npmrc` with `legacy-peer-deps=true` restores the
 * permissive pre-npm-7 behaviour for the generated project only (Vercel honours
 * the project-root `.npmrc` on install). Centralised here so every React-18 bump
 * site emits the exact same file.
 */
export const LEGACY_PEER_DEPS_NPMRC_CONTENT = 'legacy-peer-deps=true\n'

/**
 * Write the project-root `.npmrc` enabling legacy-peer-deps. `fileKey` is the
 * structure-map key (unique per emitter); the on-disk file is always `.npmrc` at
 * the project root, so if several React-18 widgets coexist the duplicate entries
 * resolve to one identical `.npmrc`.
 */
export const emitLegacyPeerDepsNpmrc = (
  structure: ProjectPluginStructure,
  fileKey: string
): void => {
  structure.files.set(fileKey, {
    path: [],
    files: [
      {
        name: '.npmrc',
        content: LEGACY_PEER_DEPS_NPMRC_CONTENT,
      },
    ],
  })
}
