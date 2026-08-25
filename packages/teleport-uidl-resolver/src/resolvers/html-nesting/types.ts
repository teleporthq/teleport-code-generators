import { UIDLElementNode, UIDLStyleSetDefinition } from '@teleporthq/teleport-types'

/**
 * Everything the walk needs that does not change as it descends.
 */
export interface NestingResolverContext {
  /** Used to make every warning traceable back to a page / component. */
  componentName: string
  /** The project stylesheet, so declared styles can be told from tag defaults. */
  projectStyleSetDefinitions?: Record<string, UIDLStyleSetDefinition>
}

/**
 * What has to happen to one `<p>` once its whole subtree has been inspected.
 *
 * Collected first and applied afterwards because the two repairs are mutually
 * exclusive: as long as every offender is a plain wrapper the paragraph can
 * stay a paragraph, but a single offender that cannot be retagged means the
 * paragraph itself has to go.
 */
export interface ParagraphRepairPlan {
  paragraph: UIDLElementNode
  /** Generic wrappers that can become `<span>` with no change in rendering. */
  retaggable: UIDLElementNode[]
  /** Tags found inside the paragraph that no tag substitution can rescue. */
  blockingTags: string[]
}

/**
 * The parser state a walk has to carry, mirroring react-dom's `ancestorInfo`.
 */
export interface NestingContext {
  /** The `<p>` that is still open in parser terms, with its repair plan. */
  paragraph?: ParagraphRepairPlan
  /** Nearest HTML ancestor tag — what the parser sees as the insertion point. */
  parentTag?: string
  /** `<a>` / `<button>` / `<nobr>` / `<form>` currently open and in scope. */
  openSelfNestingTags: Record<string, boolean>
}
