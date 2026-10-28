/**
 * Drift is silent: an uncatalogued widget is invisible to render-view, a catalogue entry without a
 * component renders an empty slot. Framework-free so a test's `toEqual([])` lists every drifted id at once.
 */
export function catalogueSyncIssues(
  definition: { widgets: ReadonlyArray<{ id: string }> },
  components: Record<string, unknown>,
): string[] {
  const issues: string[] = []
  const catalogued = definition.widgets.map((w) => w.id)
  const registered = new Set(Object.keys(components))

  const seen = new Set<string>()
  for (const id of catalogued) {
    if (seen.has(id)) issues.push(`duplicate catalogue entry: ${id}`)
    seen.add(id)
    if (!registered.has(id)) issues.push(`catalogued but no component registered: ${id}`)
  }
  for (const id of registered) {
    if (!seen.has(id)) issues.push(`component registered but not catalogued: ${id}`)
  }
  return issues
}
