import { describe, expect, it } from "vitest"
import { buildDataFeedResult, buildViewResult } from "./view-results.js"

describe("buildViewResult", () => {
  it("is the view's data as structuredContent and the model's summary as the one text block", () => {
    const data = { rows: [{ id: "pi-1" }], total: 1 }
    expect(buildViewResult(data, "1 instance.")).toEqual({
      content: [{ type: "text", text: "1 instance." }],
      structuredContent: data,
    })
  })

  it("carries no envelope: no layout, no step data, no title", () => {
    const { structuredContent } = buildViewResult({ language: "de" }, "Settings.")
    expect(Object.keys(structuredContent)).toEqual(["language"])
  })
})

describe("buildDataFeedResult", () => {
  it("is text only, so a stripping host loses nothing", () => {
    expect(buildDataFeedResult({ n: 1 })).toEqual({ content: [{ type: "text", text: '{"n":1}' }] })
  })
})
