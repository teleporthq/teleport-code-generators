import { UIDLUtils } from '@teleporthq/teleport-shared'
import { ProjectUIDL, UIDLAttributeValue, UIDLElement, UIDLNode } from '@teleporthq/teleport-types'
import {
  MOTION_ATTR_BY_PROP,
  MOTION_ELEMENT_TYPE,
  MOTION_MARKER_ATTR,
  SCENE_ATTR_BY_PROP,
  SCENE_ELEMENT_TYPE,
  SCENE_LAYOUT_ATTR,
  SCENE_LENGTH_ATTR,
  SCENE_PIN_ATTR,
  SCENE_STAGE_ATTR,
  SCENE_TRACK_ATTR,
  SCROLL_VIDEO_ATTR,
  SCROLL_VIDEO_ATTR_BY_PROP,
  SCROLL_VIDEO_ELEMENT_TYPE,
  normalizeSceneLength,
} from './contract'

/**
 * Turns the three motion elements into the markup a static page can run.
 *
 * The editor exports them the way the Next generator wants them: an element
 * type per widget (`scroll-scene-node`, `motion-node`, `scroll-video-node`)
 * with the widget's camelCase props as attributes. The HTML generator has no
 * widget to hand those to, so until now it printed them as unknown tags with
 * props an HTML parser lower-cases. Here each becomes a plain <div> that
 * carries its settings as `data-*` attributes, in the very structure the Next
 * widgets render: a scene is a track holding a sticky stage, a scroll video is
 * a host holding its <video>. Children, ids, classes and styles are untouched.
 */

export interface MotionUsage {
  scenes: boolean
  motion: boolean
  video: boolean
  /** Distinct lengths of the pinned scenes, normalised, for the stylesheet. */
  sceneLengths: string[]
}

const staticAttr = (content: string): UIDLAttributeValue =>
  ({ type: 'static', content } as UIDLAttributeValue)

/** A static prop as the text a data attribute carries; objects (from / to keyframes) as JSON. */
const attrText = (value: UIDLAttributeValue | undefined): string | undefined => {
  if (!value || value.type !== 'static') {
    return undefined
  }
  const content = (value as { content: unknown }).content
  if (content === undefined || content === null) {
    return undefined
  }
  return typeof content === 'object' ? JSON.stringify(content) : String(content)
}

const remapProps = (
  element: UIDLElement,
  attrByProp: Record<string, string>
): Record<string, UIDLAttributeValue> => {
  const attrs: Record<string, UIDLAttributeValue> = {}
  Object.entries(element.attrs || {}).forEach(([name, value]) => {
    if (!(name in attrByProp)) {
      attrs[name] = value
      return
    }
    const target = attrByProp[name]
    const text = target ? attrText(value) : undefined
    if (text !== undefined) {
      attrs[target] = staticAttr(text)
    }
  })
  return attrs
}

const asDiv = (element: UIDLElement, attrs: Record<string, UIDLAttributeValue>): void => {
  element.elementType = 'container'
  element.semanticType = 'div'
  element.attrs = attrs
  delete element.dependency
}

const transformScene = (element: UIDLElement, usage: MotionUsage): void => {
  const props = element.attrs || {}
  const pinned = attrText(props.pin) !== 'false'
  const chapters = attrText(props.layout) !== 'flow'
  const length = normalizeSceneLength(attrText(props.sceneLength))

  // `layout` is the stage's business, not the track's: an empty target drops it here.
  const attrs = remapProps(element, { ...SCENE_ATTR_BY_PROP, layout: '' })
  attrs[SCENE_TRACK_ATTR] = staticAttr('true')
  attrs[SCENE_PIN_ATTR] = staticAttr(pinned ? 'true' : 'false')
  attrs[SCENE_LENGTH_ATTR] = staticAttr(length)

  const children = element.children || []
  asDiv(element, attrs)
  usage.scenes = true
  if (!pinned) {
    return
  }
  if (!usage.sceneLengths.includes(length)) {
    usage.sceneLengths.push(length)
  }
  const stage: UIDLNode = {
    type: 'element',
    content: {
      elementType: 'container',
      semanticType: 'div',
      name: 'scene-stage',
      key: 'scene-stage',
      attrs: {
        [SCENE_STAGE_ATTR]: staticAttr('true'),
        ...(chapters ? { [SCENE_LAYOUT_ATTR]: staticAttr('chapters') } : {}),
      },
      children,
    },
  }
  element.children = [stage]
}

const transformMotion = (element: UIDLElement, usage: MotionUsage): void => {
  const attrs = remapProps(element, MOTION_ATTR_BY_PROP)
  attrs[MOTION_MARKER_ATTR] = staticAttr('true')
  asDiv(element, attrs)
  usage.motion = true
}

const transformScrollVideo = (element: UIDLElement, usage: MotionUsage): void => {
  const props = element.attrs || {}
  const src = attrText(props.src)
  const poster = attrText(props.poster)
  const mobileSrc = attrText(props.mobileSrc)

  const attrs = remapProps(element, SCROLL_VIDEO_ATTR_BY_PROP)
  attrs[SCROLL_VIDEO_ATTR] = staticAttr('true')
  asDiv(element, attrs)
  usage.video = true
  if (!src) {
    element.children = []
    return
  }
  // With a phone variant the runtime picks the source, so a phone never starts
  // downloading the desktop clip; with a single source the page names it and the
  // browser can show its first frame early. The page asks for that frame only:
  // the runtime holds the whole clip in memory (bufferWholeClip), and switches
  // back to preloading only where it cannot.
  const videoAttrs: Record<string, UIDLAttributeValue> = {
    muted: staticAttr('true'),
    playsinline: staticAttr('true'),
    preload: staticAttr('metadata'),
    ...(poster ? { poster: staticAttr(poster) } : {}),
    ...(mobileSrc ? {} : { src: staticAttr(src) }),
  }
  element.children = [
    {
      type: 'element',
      content: {
        elementType: 'video',
        name: 'scroll-video-clip',
        key: 'scroll-video-clip',
        attrs: videoAttrs,
        children: [],
      },
    },
  ]
}

export const transformMotionElements = (uidl: ProjectUIDL): MotionUsage => {
  const usage: MotionUsage = { scenes: false, motion: false, video: false, sceneLengths: [] }
  const visit = (element: UIDLElement) => {
    switch (element.elementType) {
      case SCENE_ELEMENT_TYPE:
        transformScene(element, usage)
        break
      case MOTION_ELEMENT_TYPE:
        transformMotion(element, usage)
        break
      case SCROLL_VIDEO_ELEMENT_TYPE:
        transformScrollVideo(element, usage)
        break
      default:
        break
    }
  }
  UIDLUtils.traverseElements(uidl.root.node, visit)
  Object.values(uidl.components || {}).forEach((component) => {
    UIDLUtils.traverseElements(component.node, visit)
  })
  return usage
}
