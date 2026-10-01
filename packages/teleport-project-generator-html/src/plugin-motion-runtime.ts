import { GenericUtils, UIDLUtils } from '@teleporthq/teleport-shared'
import {
  FileType,
  GeneratedFile,
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLElement,
} from '@teleporthq/teleport-types'
import { appendGlobalCss } from './global-css'
import {
  MOTION_MARKER_ATTR,
  MOTION_RUNTIME_FILE_NAME,
  PAGE_FLAG_ATTR,
  RUNTIME_FAILSAFE_MS,
  RUNTIME_FLAG,
  SCENE_LENGTH_ATTR,
  SCENE_PIN_ATTR,
  SCENE_TRACK_ATTR,
  SCROLL_VIDEO_ATTR,
} from './motion/contract'
import { motionCss, sceneCss, scrollVideoCss } from './motion/runtime-css'
import { motionRuntimeScript } from './motion/runtime-script'
import { MotionUsage, transformMotionElements } from './motion/uidl-transform'

/**
 * Motion in the static HTML export: scroll scenes, element motion and scroll
 * video play in a downloaded site the way they play in the Next export.
 *
 *   before generation  the three motion elements become plain markup
 *                      (motion/uidl-transform.ts)
 *   after generation   the layout rules join the global stylesheet
 *                      (motion/runtime-css.ts), ONE script file is added next
 *                      to it (motion/runtime-script.ts) and every page links it
 *
 * Nothing is emitted for a project that uses none of it, and only the parts a
 * project uses are emitted. The page tells the stylesheet it will be animated
 * from a one-line head script; if the runtime file never arrives (blocked,
 * moved, offline copy) the same script withdraws that after a few seconds, so
 * no content can stay hidden behind an animation that will not run.
 */

const FILES_KEY = 'tq-motion-runtime'

const staticText = (element: UIDLElement, attr: string): string | undefined => {
  const value = element.attrs?.[attr] as { type?: string; content?: unknown } | undefined
  return value && value.type === 'static' ? String(value.content) : undefined
}

/** Read back from the transformed UIDL, so the plugin holds no state between its two passes. */
const motionUsage = (uidl: ProjectPluginStructure['uidl']): MotionUsage => {
  const usage: MotionUsage = { scenes: false, motion: false, video: false, sceneLengths: [] }
  const visit = (element: UIDLElement) => {
    if (staticText(element, SCENE_TRACK_ATTR) !== undefined) {
      usage.scenes = true
      const length = staticText(element, SCENE_LENGTH_ATTR)
      if (
        length &&
        staticText(element, SCENE_PIN_ATTR) !== 'false' &&
        !usage.sceneLengths.includes(length)
      ) {
        usage.sceneLengths.push(length)
      }
    }
    if (staticText(element, MOTION_MARKER_ATTR) !== undefined) {
      usage.motion = true
    }
    if (staticText(element, SCROLL_VIDEO_ATTR) !== undefined) {
      usage.video = true
    }
  }
  UIDLUtils.traverseElements(uidl.root.node, visit)
  Object.values(uidl.components || {}).forEach((component) => {
    UIDLUtils.traverseElements(component.node, visit)
  })
  return usage
}

export const MOTION_HEAD_SCRIPT =
  `(function (root) {\n` +
  `  root.setAttribute('${PAGE_FLAG_ATTR}', '')\n` +
  `  setTimeout(function () {\n` +
  `    if (!window.${RUNTIME_FLAG}) { root.removeAttribute('${PAGE_FLAG_ATTR}') }\n` +
  `  }, ${RUNTIME_FAILSAFE_MS})\n` +
  `})(document.documentElement)`

const linkRuntime = (structure: ProjectPluginStructure, runtimePath: string[]): void => {
  structure.files.forEach((entry, key) => {
    if (key === FILES_KEY) {
      return
    }
    // The strategy spells "the project root" as [''], which would print `..//`.
    const prefix = GenericUtils.generateLocalDependenciesPrefix(
      entry.path.filter(Boolean),
      runtimePath.filter(Boolean)
    )
    const tags =
      `<script>\n${MOTION_HEAD_SCRIPT}\n</script>\n` +
      `<script defer src="${prefix}${MOTION_RUNTIME_FILE_NAME}.js"></script>\n`
    structure.files.set(key, {
      ...entry,
      files: entry.files.map((file: GeneratedFile) =>
        // A page has a head; a component fragment does not, and is never linked.
        file.fileType === FileType.HTML && file.content.includes('</head>')
          ? { ...file, content: file.content.replace('</head>', `${tags}</head>`) }
          : file
      ),
    })
  })
}

export class ProjectPluginMotionRuntime implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure) {
    transformMotionElements(structure.uidl)
    return structure
  }

  async runAfter(structure: ProjectPluginStructure) {
    const usage = motionUsage(structure.uidl)
    if (!usage.scenes && !usage.motion && !usage.video) {
      return structure
    }
    appendGlobalCss(
      structure,
      [
        usage.scenes ? sceneCss(usage.sceneLengths) : '',
        usage.video ? scrollVideoCss() : '',
        usage.motion ? motionCss() : '',
      ]
        .filter(Boolean)
        .join('\n')
    )
    const runtimePath = structure.strategy.projectStyleSheet?.path ?? ['']
    structure.files.set(FILES_KEY, {
      path: runtimePath,
      files: [
        {
          name: MOTION_RUNTIME_FILE_NAME,
          fileType: FileType.JS,
          content: motionRuntimeScript(usage),
        },
      ],
    })
    linkRuntime(structure, runtimePath)
    return structure
  }
}

export const pluginMotionRuntime = new ProjectPluginMotionRuntime()
