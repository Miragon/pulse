/**
 * Where an instance's diagram marks its tokens and incidents, which its view's facts for the model
 * name too: the activities of its activity instance tree and of its incidents, each on the element
 * of the diagram. A multi-instance body (`<id>#multiInstanceBody`, which no shape has) counts on
 * the activity it repeats by c7-core's rule (`elementOfActivity`) only while its own token waits
 * there, as the contract's element counts put it, never as a token beside the items it runs.
 */

import { elementOfActivity, isMultiInstanceBody } from "@miragon/pulse-c7-core"

interface TreeNode {
  activityId?: string
  childActivityInstances?: TreeNode[]
  childTransitionInstances?: Array<{ activityId?: string }>
}

/**
 * The element of every activity and transition instance of the tree, one per instance: a
 * multi-instance body's where its own token waits (a transition instance, or a body that runs no
 * item), none for a body whose items run, each of which counts on the element itself.
 */
export function collectActiveActivityIds(tree: unknown): string[] {
  return collect(tree as TreeNode | null).map(elementOfActivity)
}

/** Whether `node` is a multi-instance body that runs items, which are the element's tokens. */
function runsItems(node: TreeNode): boolean {
  const items =
    (node.childActivityInstances?.length ?? 0) + (node.childTransitionInstances?.length ?? 0)
  return node.activityId !== undefined && isMultiInstanceBody(node.activityId) && items > 0
}

function collect(node: TreeNode | null): string[] {
  if (!node) return []
  const ids: string[] = []
  if (node.activityId && !runsItems(node)) ids.push(node.activityId)
  for (const c of node.childActivityInstances ?? []) ids.push(...collect(c))
  for (const t of node.childTransitionInstances ?? []) {
    if (t.activityId) ids.push(t.activityId)
  }
  return ids
}

/**
 * The element of each incident's activity, once each, and beside it a multi-instance body's own
 * id, which the engine's incident filter and the history's rows name; an incident without an
 * activity marks none.
 */
export function collectIncidentActivityIds(incidents: unknown): string[] {
  const rows = Array.isArray(incidents) ? (incidents as Array<{ activityId?: string | null }>) : []
  const activities = rows.map((i) => i.activityId).filter(Boolean) as string[]
  return [...new Set(activities.flatMap((id) => [elementOfActivity(id), id]))]
}
