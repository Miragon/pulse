import { FakeEngine, FakeWorld } from "../../src/contract/fake/index.js"
import { describe, expect, test } from "vitest"
import { DefinitionNodes } from "../../src/core/explorer/definition-nodes.js"
import { Labels } from "../../src/core/views/labels.js"

describe("labels", () => {
  test("show the head of a UUID and the tail of a long numeric key", () => {
    expect(Labels.shortId("8f3c2a1e-0000-4000-8000-000000000001")).toBe("8f3c2a1e…")
    expect(Labels.shortId("2251799813685249")).toBe("…13685249")
    expect(Labels.shortId("ORD-1")).toBe("ORD-1")
  })

  test("humanize engine types without knowing any engine", () => {
    expect(Labels.humanize("failedJob")).toBe("Failed job")
    expect(Labels.humanize("JOB_NO_RETRIES")).toBe("Job no retries")
  })
})

describe("the definition nodes", () => {
  test("are sorted by name and describe version and load", async () => {
    const { state } = FakeWorld.seed()
    const nodes = await new DefinitionNodes(new FakeEngine(state)).list()
    expect(nodes.map((node) => [node.label, node.description, node.withIncident])).toEqual([
      ["Dispatch order", "1 running in all versions · latest v1", 1],
      ["Order fulfillment", "3 running in all versions · latest v2", 1],
      ["Print label", "1 running in all versions · latest v1", 1],
    ])
  })
})
