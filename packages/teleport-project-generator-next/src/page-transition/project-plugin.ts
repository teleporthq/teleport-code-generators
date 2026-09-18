import { FileType, ProjectPlugin, ProjectPluginStructure } from '@teleporthq/teleport-types'
import { PageTransition } from '@teleporthq/teleport-shared'
import { injectImportIntoApp } from '../app-import-injection'
import { emitLegacyPeerDepsNpmrc } from '../npmrc-legacy-peer-deps'
import { generatePageTransitionComponentCode } from './page-transition-component'

const PAGE_MOUNT = '<Component {...pageProps} />'
const WRAPPED_PAGE_MOUNT = '<TqPageTransition><Component {...pageProps} /></TqPageTransition>'
const IMPORT_LINE = "import TqPageTransition from '../components/tq-page-transition';"

/** The resolved transition the editor exported, or null when pages switch instantly. */
export const projectPageTransition = PageTransition.projectPageTransition

/**
 * Wraps the page mount in `_app` with the site's route transition — only when
 * the project chose one, so every other project's `_app` is byte-identical.
 * framer-motion (and the React 18 it needs) is registered the same way the
 * motion widget does it, since a site can transition without a single Motion
 * element on it.
 */
export class NextPageTransitionProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const transition = projectPageTransition(structure.uidl)
    if (!transition) {
      return structure
    }

    structure.files.set('tq-page-transition', {
      path: ['components'],
      files: [
        {
          name: 'tq-page-transition',
          fileType: FileType.JS,
          content: generatePageTransitionComponentCode(transition),
        },
      ],
    })

    structure.dependencies['framer-motion'] = '^11.18.0'
    structure.dependencies.react = '^18.3.1'
    structure.dependencies['react-dom'] = '^18.3.1'
    emitLegacyPeerDepsNpmrc(structure, 'tq-page-transition-npmrc')

    const appFile = findAppFile(structure)
    if (!appFile || appFile.content.includes(WRAPPED_PAGE_MOUNT)) {
      return structure
    }
    if (!appFile.content.includes(PAGE_MOUNT)) {
      return structure
    }
    appFile.content = appFile.content.replace(PAGE_MOUNT, WRAPPED_PAGE_MOUNT)
    injectImportIntoApp(structure, IMPORT_LINE)
    return structure
  }
}

const findAppFile = (structure: ProjectPluginStructure): { content: string } | null => {
  for (const [key, record] of Array.from(structure.files.entries())) {
    if (key === '_app' || key.includes('_app')) {
      const candidate = record.files?.find(
        (file) => file.name === '_app' && (file.fileType === 'js' || file.fileType === 'tsx')
      )
      if (candidate && typeof candidate.content === 'string') {
        return candidate
      }
    }
  }
  return null
}
