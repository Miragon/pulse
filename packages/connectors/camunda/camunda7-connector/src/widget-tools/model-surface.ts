import type { MCPServer } from "mcp-use"

/**
 * What hand-offs may name (#338). Recorded, not re-derived: every registration path goes
 * through {@link ModelSurface.record}, so the list IS `tools/list` minus the app-only feeds.
 */
export interface ModelSurface {
  record: (server: MCPServer) => MCPServer
  tools: () => string[]
}

type ToolDefinition = Parameters<MCPServer["tool"]>[0]
type ToolCallback = Parameters<MCPServer["tool"]>[1]

function isAppOnly(definition: ToolDefinition): boolean {
  const { visibility } = definition as { visibility?: unknown }
  return visibility === "app" || (Array.isArray(visibility) && !visibility.includes("model"))
}

export function createModelSurface(): ModelSurface {
  const names = new Set<string>()
  return {
    record(server) {
      // A Proxy, not a spread, so mcp-use internals and the toolkit's duplicate-name guard keep working.
      return new Proxy(server, {
        get(target, property) {
          if (property === "tool") {
            return (definition: ToolDefinition, callback: ToolCallback) => {
              const registered = target.tool(definition, callback)
              if (!isAppOnly(definition)) names.add(definition.name)
              return registered
            }
          }
          const value: unknown = Reflect.get(target, property, target)
          return typeof value === "function" ? (value as () => unknown).bind(target) : value
        },
      })
    },
    tools: () => [...names].sort(),
  }
}
