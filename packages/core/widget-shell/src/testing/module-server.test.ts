import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server"
import { ResourceTemplate } from "@modelcontextprotocol/server"
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

  const BOARD_URI = "ui://acme/board.html"
  const html = () => ({
    contents: [{ uri: BOARD_URI, mimeType: RESOURCE_MIME_TYPE, text: "<!doctype html>" }],
  })

  it("records a resource by URI, also through ext-apps' registerAppResource, and reads it", async () => {
    const recording = recordingModuleServer()
    registerAppResource(recording.server, "Board", BOARD_URI, { description: "A board." }, html)
    const board = recording.resource(BOARD_URI)
    expect(board).toMatchObject({
      name: "Board",
      uri: BOARD_URI,
      config: { mimeType: RESOURCE_MIME_TYPE, description: "A board." },
    })
    expect((await board.read()).contents[0]).toMatchObject({ text: "<!doctype html>" })
  })

  it("calls a read as the SDK does: (url, ctx), a template's (url, variables, ctx)", async () => {
    const recording = recordingModuleServer()
    const seen: unknown[][] = []
    const callback = (...args: unknown[]) => {
      seen.push(args)
      return { contents: [] }
    }
    const ctx = testServerContext()
    recording.server.registerResource("Board", BOARD_URI, {}, callback)
    await recording.resource(BOARD_URI).read(BOARD_URI, ctx)
    const template = new ResourceTemplate("ui://acme/{id}.html", { list: undefined })
    recording.server.registerResource("Item", template, {}, callback)
    await recording.resource("ui://acme/{id}.html").read("ui://acme/7.html", ctx)
    expect(seen).toEqual([
      [new URL(BOARD_URI), ctx],
      [new URL("ui://acme/7.html"), { id: "7" }, ctx],
    ])
    await expect(
      recording.resource("ui://acme/{id}.html").read("ui://acme/7/8.html"),
    ).rejects.toThrow(
      "ui://acme/7/8.html does not match the resource template ui://acme/{id}.html.",
    )
  })

  it("refuses a second registration of a URI or a template's name, and names what it holds", () => {
    const recording = recordingModuleServer()
    recording.server.registerResource("Board", BOARD_URI, {}, html)
    expect(() => recording.server.registerResource("Other", BOARD_URI, {}, html)).toThrow(
      `Resource ${BOARD_URI} is already registered`,
    )
    const template = (uri: string) => new ResourceTemplate(uri, { list: undefined })
    recording.server.registerResource("Item", template("ui://acme/{id}.html"), {}, html)
    expect(() =>
      recording.server.registerResource("Item", template("ui://acme/x/{id}.html"), {}, html),
    ).toThrow("is already registered")
    expect(() => recording.resource("ui://none")).toThrow(
      `No resource "ui://none"; registered: ${BOARD_URI}, ui://acme/{id}.html.`,
    )
    expect(() => recordingModuleServer().resource("ui://none")).toThrow("registered: none.")
  })
})
