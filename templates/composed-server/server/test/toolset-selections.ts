import { MODULES } from "../src/setup.js"

/**
 * One `MCP_ACTIVE_MODULES` selection per toolset DEPTH: boot `i` runs every
 * composed module on its `i`-th declared toolset (its last one once it has
 * no more; a module without toolsets by its bare name). Together the boots
 * register every tool any toolset registers. The default boot would not: it
 * puts every module on its read-only floor, which hides every write tool
 * above it (an engine write, a destructive registrar tool). Derived from
 * `MODULES`, not hand-listed: your module's toolsets are covered the moment
 * it declares them.
 */
export function toolsetSelections(): string[] {
  const depth = Math.max(1, ...MODULES.map((module) => module.toolsets?.names.length ?? 1))
  return Array.from({ length: depth }, (_, i) =>
    MODULES.map(({ name, toolsets }) =>
      toolsets ? `${name}:${toolsets.names[Math.min(i, toolsets.names.length - 1)]}` : name,
    ).join(","),
  )
}
