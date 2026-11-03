import {
  ProjectPlugin,
  ProjectPluginStructure,
  UIDLElement,
  UIDLNode,
} from '@teleporthq/teleport-types'
import {
  ageGateActive,
  resolveAccessRulesRuntime,
  resolveAccessRulesSettings,
} from '../access-rules/settings'
import { buildGateHeadSnippet } from '../access-rules/gate-runtime-source'
import {
  collectExperimentIds,
  EXPERIMENT_ATTR,
  EXPERIMENT_VARIANT_ATTR,
} from '../analytics/experiments'
import { traverseProjectElements } from '../uidl-element-traversal'

type ProjectUIDL = ProjectPluginStructure['uidl']

const prependHead = (uidl: ProjectUIDL, snippet: string) => {
  const customCode = uidl.globals.customCode ?? {}
  uidl.globals.customCode = { ...customCode, head: `${snippet}${customCode.head ?? ''}` }
}

/**
 * The editor draws its Age Gate component open on every page; the published
 * site's head script hides it for a visitor who confirmed, or on a page it
 * does not cover. Without that script the gate stays open and nothing on it
 * closes it, so the snippet goes in, answering the gate's controls itself.
 */
const addAgeGate = (uidl: ProjectUIDL) => {
  const settings = resolveAccessRulesSettings(uidl)
  if (!settings) {
    return
  }
  const runtime = resolveAccessRulesRuntime(uidl)
  if (runtime.gate !== 'component' || !ageGateActive(settings, runtime)) {
    return
  }
  prependHead(uidl, buildGateHeadSnippet(settings, runtime, { withoutWorkflows: true }))
}

/** A popup component's instance, or a branch that holds only one. */
const isInstanceOf = (node: UIDLNode, components: Set<string>): boolean => {
  if (node?.type === 'conditional') {
    return isInstanceOf((node.content as { node: UIDLNode }).node, components)
  }
  if (node?.type !== 'element') {
    return false
  }
  const element = node.content as UIDLElement
  return element.elementType === 'component' && components.has(element.semanticType ?? '')
}

/**
 * A popup opens and closes through its workflows, which this export does not
 * run: the instances the editor put on every page are left out, rather than
 * shipped as popups that can never open.
 */
const removePopups = (uidl: ProjectUIDL) => {
  const popups = uidl.popups?.popups ?? []
  if (popups.length === 0) {
    return
  }
  const components = new Set<string>()
  for (const popup of popups) {
    components.add(popup.componentName)
    const name = uidl.components?.[popup.componentName]?.name
    if (name) {
      components.add(name)
    }
  }
  traverseProjectElements(uidl, (element) => {
    if (element.children?.length) {
      element.children = element.children.filter((child) => !isInstanceOf(child, components))
    }
  })
}

const staticAttr = (element: UIDLElement, name: string): unknown => {
  const attr = element.attrs?.[name]
  return attr?.type === 'static' ? attr.content : undefined
}

/**
 * Both versions of an A/B test are on the page; the published site's head
 * script shows a visitor one of them and its tracker counts the result. A
 * download counts nothing, so it shows the original alone.
 */
const keepOriginalVersions = (uidl: ProjectUIDL) => {
  const experiments = new Set(collectExperimentIds(uidl))
  if (experiments.size === 0) {
    return
  }
  const isVariation = (node: UIDLNode) => {
    if (node?.type !== 'element') {
      return false
    }
    const element = node.content as UIDLElement
    return (
      experiments.has(staticAttr(element, EXPERIMENT_ATTR) as string) &&
      staticAttr(element, EXPERIMENT_VARIANT_ATTR) === 'b'
    )
  }
  traverseProjectElements(uidl, (element) => {
    if (element.children?.length) {
      element.children = element.children.filter((child) => !isVariation(child))
    }
  })
}

/**
 * A download other than the Next.js app (HTML, React, Vue, Nuxt, Angular)
 * runs none of the project's workflows, and none of the head scripts the Next
 * project plugins add. What those scripts do on the published site is done
 * here, or the feature is left out with nothing broken:
 *  - the age gate: its head snippet, answering the gate's controls by their
 *    marks;
 *  - popups: left out;
 *  - A/B tests: the original version alone.
 * A project with none of them comes out exactly as before.
 */
export class StaticExportProjectPlugin implements ProjectPlugin {
  async runBefore(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    const { uidl } = structure
    addAgeGate(uidl)
    removePopups(uidl)
    keepOriginalVersions(uidl)
    return structure
  }

  async runAfter(structure: ProjectPluginStructure): Promise<ProjectPluginStructure> {
    return structure
  }
}
