import type { ModuleServer } from "@miragon/pulse-widget-shell/server"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import type { z } from "zod"

export type ToolResult = {
  isError?: boolean
  content: Array<{ type: string; text: string }>
  structuredContent: Record<string, unknown>
}
export type Definition = { name: string; description: string; inputSchema: z.ZodObject }
export type Handler = (args: Record<string, unknown>) => Promise<ToolResult>
export type Tool = { definition: Definition; handler: Handler }

/**
 * The tools `register` adds: each config as its definition, each callback called the way the SDK
 * calls it (args unvalidated: a handler called directly gets no schema defaults).
 */
export function recordedTools(register: (server: ModuleServer) => void): Map<string, Tool> {
  const recording = recordingModuleServer()
  register(recording.server)
  return new Map(
    [...recording.tools].map(([name, tool]) => [
      name,
      {
        definition: { name, ...tool.config } as Definition,
        handler: (args) => tool.call(args) as Promise<ToolResult>,
      },
    ]),
  )
}
