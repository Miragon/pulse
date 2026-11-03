import { describe, expect, it } from "vitest"
import { decodeToolResult, ToolResultError, type ToolResult } from "./tool-result.js"

describe("decodeToolResult (structuredContent first)", () => {
  it("prefers structuredContent over the text channel", () => {
    const result = {
      content: [{ type: "text", text: "Process list: 2 definitions." }],
      structuredContent: { items: [1, 2], total: 2 },
    }
    expect(decodeToolResult(result)).toEqual({ items: [1, 2], total: 2 })
  })

  it("prefers structuredContent even when the text channel is parseable JSON", () => {
    const result = {
      content: [{ type: "text", text: JSON.stringify({ fromText: true }) }],
      structuredContent: { fromStructured: true },
    }
    expect(decodeToolResult(result)).toEqual({ fromStructured: true })
  })

  it("falls back to JSON-decoding the text block without structuredContent (a *_data feed)", () => {
    const result = {
      content: [{ type: "text", text: JSON.stringify({ items: [1, 2], total: 2 }) }],
      structuredContent: null,
    }
    expect(decodeToolResult(result)).toEqual({ items: [1, 2], total: 2 })
  })

  it("reads the first block that carries text", () => {
    const result = {
      content: [{ type: "image" }, { type: "text", text: '{"n":1}' }],
    }
    expect(decodeToolResult(result)).toEqual({ n: 1 })
  })

  it("returns non-JSON text verbatim", () => {
    const result = { content: [{ type: "text", text: "plain status line" }] }
    expect(decodeToolResult<string>(result)).toBe("plain status line")
  })

  it("falls back to the raw result when neither channel is present", () => {
    const result = { something: "else" } as ToolResult
    expect(decodeToolResult(result)).toEqual({ something: "else" })
  })

  it("throws the tool's own isError answer as a ToolResultError with its text", () => {
    const result = { isError: true, content: [{ type: "text", text: "boom" }] }
    let thrown: unknown
    try {
      decodeToolResult(result)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ToolResultError)
    expect(thrown).toMatchObject({ name: "ToolResultError", message: "boom", result })
  })

  it("throws a generic message on an isError result without text", () => {
    expect(() => decodeToolResult({ isError: true })).toThrowError("Tool call failed")
  })
})
