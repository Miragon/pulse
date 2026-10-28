// Environments only group engines; ids stay flat and globally unique (the metrics' `engine_id` join key).

export const DEFAULT_ENVIRONMENT_ID = "default"

export function environmentOf(engine: { environment?: string }): string {
  return engine.environment ?? DEFAULT_ENVIRONMENT_ID
}

export interface EnvironmentGroup<E> {
  id: string
  engines: E[]
}

/** First-appearance order, as the deployment wrote it; one group means "no environment stage". */
export function groupEnginesByEnvironment<E extends { environment?: string }>(
  engines: E[],
): EnvironmentGroup<E>[] {
  const groups = new Map<string, E[]>()
  for (const engine of engines) {
    const id = environmentOf(engine)
    const group = groups.get(id)
    if (group) group.push(engine)
    else groups.set(id, [engine])
  }
  return [...groups.entries()].map(([id, grouped]) => ({ id, engines: grouped }))
}

export function formatEnginesByEnvironment(
  groups: Array<EnvironmentGroup<{ id: string }>>,
): string {
  return groups.length > 1
    ? groups.map((g) => `${g.id}: ${g.engines.map((e) => e.id).join(", ")}`).join("; ")
    : (groups[0]?.engines ?? []).map((e) => e.id).join(", ")
}

/** Undefined for a single environment; derived from the same groups the widget renders. */
export function enginesByEnvironment(
  groups: Array<EnvironmentGroup<{ id: string }>>,
): string[] | undefined {
  return groups.length > 1
    ? groups.flatMap((g) => g.engines.map((e) => `${g.id}/${e.id}`))
    : undefined
}
