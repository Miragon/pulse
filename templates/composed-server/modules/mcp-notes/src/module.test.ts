import type { MCPServer } from "mcp-use"
import { describe, expect, it } from "vitest"
import { notesModule } from "./module.js"

/** The tool names a plugin registers, read off a stand-in server that only records them. */
function registeredToolNames(plugin: { register(server: MCPServer): void }): string[] {
  const names: string[] = []
  const server = { tool: (definition: { name: string }) => void names.push(definition.name) }
  plugin.register(server as unknown as MCPServer)
  return names
}

/**
 * The module port as the server's boot uses it. Which widgets the server can
 * render and how the tools behave on the wire are the server's guard tests
 * (`server/test/`); they cover this module through its dependency.
 */
describe("notes module", () => {
  const plugin = notesModule.createPlugin(notesModule.configFromEnv({}))

  it("names its plugin after the module: the owner the boot names on a duplicate tool name", () => {
    expect(plugin.name).toBe(notesModule.name)
  })

  it("registers the plain tool, the show tool and its data feed, all under the module prefix", () => {
    expect(registeredToolNames(plugin)).toEqual([
      "notes_list_notes",
      "notes_show_notes",
      "notes_list_data",
    ])
  })
})
