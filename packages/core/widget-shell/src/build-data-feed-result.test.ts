import { describe, expect, it } from "vitest"
import { parseToolResult, parseViewToolResult } from "@miragon/mcp-toolkit-ui"
import { buildDataFeedResult } from "./server.js"

/** No widget `_meta`: a result with `ui.resourceUri` would be rendered by the host, not returned to `callTool()`. */
describe("buildDataFeedResult", () => {
  const data = { rows: [{ id: "pi-1" }], total: 1 }
  const result = buildDataFeedResult(data)

  it("puts the payload on the text channel as compact JSON", () => {
    expect(result.content).toEqual([{ type: "text", text: '{"rows":[{"id":"pi-1"}],"total":1}' }])
  })

  it("is read back by the toolkit's parsers, which fall back to the JSON text", () => {
    expect(parseToolResult(result)).toEqual(data)
    expect(parseViewToolResult(result)).toEqual(data)
  })

  it("sends the payload once — no structuredContent copy, no widget _meta, no view binding", () => {
    expect(Object.keys(result)).toEqual(["content"])
  })

  it("stays a plain JSON envelope for an empty payload", () => {
    expect(buildDataFeedResult({}).content).toEqual([{ type: "text", text: "{}" }])
  })
})
