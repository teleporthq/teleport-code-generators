import type { UIDLWorkflowNode } from '@teleporthq/teleport-types'
import type { SegmentTrust } from './segment-trust'
import { describeStep, stepResultsReadBy } from './server-custom-node-call'
import { WorkflowSegment } from './types'

/**
 * `sealResultOnServer: true` in a server step's config: its result reaches the
 * browser sealed — encrypted and authenticated with a key derived from the app
 * secret, bound to the workflow, the run and the step — so the browser holds
 * it between two server requests without being able to read or change it, and
 * every later server route of the same run opens it before its steps read it
 * (see the server runtime: `sealForRun`, `openResultsSealedForRun`).
 *
 * `keepResultOnServer` keeps a result on the server outright, so no later
 * request can read it; a sealed result serves the later server requests of
 * its run too. A step with both keeps its result. An if / switch is never
 * sealed: the browser branches on its decision.
 *
 * Only a server step's result is sealed. A step in the visitor's browser that
 * reads one gets nothing it can use, so publishing refuses such a workflow
 * (`findBrowserReadsOfSealedResults`).
 */
export const SEAL_RESULT_ON_SERVER_KEY = 'sealResultOnServer'

/** The one key of a result sealed for its run, as the browser holds it. */
export const SEALED_FOR_RUN_KEY = '__sealedForRun'

const isBranchingNodeType = (type: string): boolean =>
  type === 'general-if-statement' || type === 'general-switch'

/** Whether a step's config asks for its result to be sealed (see above). */
export const asksForSealedResult = (node: UIDLWorkflowNode): boolean => {
  const config = node.config as Record<string, unknown> | undefined
  return (
    !!config &&
    config[SEAL_RESULT_ON_SERVER_KEY] === true &&
    config.keepResultOnServer !== true &&
    !isBranchingNodeType(node.type)
  )
}

export interface BrowserReadOfSealedResult {
  nodeId: string
  message: string
}

interface SealedResultReadOptions {
  /** The workflow's or custom node's name. */
  owner: string
  /** Its nodes: the steps that may read the segment's sealed results. */
  graphNodes?: UIDLWorkflowNode[]
}

/**
 * Every step of the graph that runs in the browser and reads a result this
 * server segment seals, naming the step and the result. Each sealed step is
 * produced by one segment, so each read is reported once over the graph's
 * routes.
 */
export const findBrowserReadsOfSealedResults = (
  segment: WorkflowSegment,
  trust: SegmentTrust | undefined,
  options: SealedResultReadOptions
): BrowserReadOfSealedResult[] => {
  const sealedHere = new Set(
    ((trust && trust.sealedNodeIds) || []).filter((id) => segment.nodeIds.indexOf(id) !== -1)
  )
  if (sealedHere.size === 0) {
    return []
  }
  const serverRun = new Set<string>([...segment.nodeIds, ...((trust && trust.signedNodeIds) || [])])
  const graphNodes = options.graphNodes || segment.nodes
  const byId = new Map<string, UIDLWorkflowNode>()
  for (const node of graphNodes) {
    byId.set(node.id, node)
  }
  const found: BrowserReadOfSealedResult[] = []
  for (const node of graphNodes) {
    if (!node || serverRun.has(node.id)) {
      continue
    }
    const sealed = stepResultsReadBy(node.config).find((id) => sealedHere.has(id))
    if (!sealed) {
      continue
    }
    found.push({
      nodeId: node.id,
      message: `The step ${describeStep(node, node.id)} in "${
        options.owner
      }" reads the result of ${describeStep(
        byId.get(sealed),
        sealed
      )}, which stays sealed outside the site's server, so a step in the visitor's browser cannot read it. Read it in a step that runs on the server, or run the setup of the feature that made this workflow again, then publish again.`,
    })
  }
  return found
}

/** Throws the first of `findBrowserReadsOfSealedResults`: the export stops there. */
export const assertNoBrowserReadsOfSealedResults = (
  segment: WorkflowSegment,
  trust: SegmentTrust | undefined,
  options: SealedResultReadOptions
): void => {
  const [first] = findBrowserReadsOfSealedResults(segment, trust, options)
  if (first) {
    throw new Error(first.message)
  }
}
