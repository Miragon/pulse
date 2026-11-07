import { describe, expect, it } from "vitest"
import { z } from "zod"
import { strictToolInput } from "../widget-tool-bindings.js"
import { recordingModuleServer, testServerContext } from "./module-server.js"

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] })

describe("recordingModuleServer", () => {
  it("records each tool and prompt as the module passed it", () => {
    const recording = recordingModuleServer()
    const config = { description: "Lists.", inputSchema: strictToolInput({ q: z.string() }) }
    recording.server.registerTool("x_list", config, () => ok("listed"))
    recording.server.registerPrompt("x_draft", { description: "Drafts." }, () => ({
      messages: [],
    }))
    expect(recording.tool("x_list").config).toBe(config)
    expect([...recording.prompts.keys()]).toEqual(["x_draft"])
  })

  it("calls a callback as the SDK does: (args, ctx) with a schema, (ctx) without", async () => {
    const recording = recordingModuleServer()
    const seen: unknown[][] = []
    recording.server.registerTool("x_none", {}, (...args: unknown[]) => {
      seen.push(args)
      return ok("none")
    })
    recording.server.registerTool(
      "x_some",
      { inputSchema: strictToolInput({ q: z.string() }) },
      (...args: unknown[]) => {
        seen.push(args)
        return ok("some")
      },
    )
    const ctx = testServerContext()
    expect((await recording.tool("x_none").call({}, ctx)).content[0].text).toBe("none")
    await recording.tool("x_some").call({ q: "a" }, ctx)
    expect(seen).toEqual([[ctx], [{ q: "a" }, ctx]])
  })

  it("hands a call without ctx one whose signal is live", async () => {
    const recording = recordingModuleServer()
    let aborted: boolean | undefined
    recording.server.registerTool("x_probe", {}, (ctx) => {
      aborted = ctx.mcpReq.signal.aborted
      return ok("probed")
    })
    await recording.tool("x_probe").call()
    expect(aborted).toBe(false)
    const controller = new AbortController()
    controller.abort()
    expect(testServerContext(controller.signal).mcpReq.signal.aborted).toBe(true)
  })

  it("refuses a second registration of a name, as the SDK does, and names what it holds", () => {
    const recording = recordingModuleServer()
    recording.server.registerTool("x_list", {}, () => ok("a"))
    expect(() => recording.server.registerTool("x_list", {}, () => ok("b"))).toThrow(
      "Tool x_list is already registered",
    )
    expect(() => recording.tool("x_other")).toThrow('No tool "x_other"; registered: x_list.')
    expect(() => recordingModuleServer().tool("x")).toThrow("registered: none.")
  })
})
