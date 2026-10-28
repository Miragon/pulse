interface TreeNode {
  activityId?: string
  childActivityInstances?: TreeNode[]
  childTransitionInstances?: Array<{ activityId?: string }>
}

export function collectActiveActivityIds(tree: unknown): string[] {
  return collect(tree as TreeNode | null)
}

function collect(node: TreeNode | null): string[] {
  if (!node) return []
  const ids: string[] = []
  if (node.activityId) ids.push(node.activityId)
  for (const c of node.childActivityInstances ?? []) ids.push(...collect(c))
  for (const t of node.childTransitionInstances ?? []) {
    if (t.activityId) ids.push(t.activityId)
  }
  return ids
}

/** The root node is the process instance itself; a multi-instance activity counts once per token. */
export function countActivityInstances(tree: unknown): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (id: string | undefined) => {
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const visit = (node: TreeNode) => {
    for (const child of node.childActivityInstances ?? []) {
      add(child.activityId)
      visit(child)
    }
    for (const transition of node.childTransitionInstances ?? []) add(transition.activityId)
  }
  if (tree) visit(tree)
  return counts
}

export function collectIncidentActivityIds(incidents: unknown): string[] {
  const rows = Array.isArray(incidents) ? (incidents as Array<{ activityId?: string | null }>) : []
  return [...new Set(rows.map((i) => i.activityId).filter(Boolean) as string[])]
}
