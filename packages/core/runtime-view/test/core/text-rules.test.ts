import { getFormatLocale } from "@miragon/pulse-ui/format"
import { FakeEngine, FakeWorld } from "@miragon/pulse-engine-core/testing"
import { describe, expect, test } from "vitest"
import { DefinitionNodes } from "../../src/core/explorer/definition-nodes.js"
import { BulkRequests } from "../../src/core/views/bulk-requests.js"
import { Labels } from "../../src/core/views/labels.js"

describe("labels", () => {
  test("show the head of a UUID and the tail of a long numeric key", () => {
    expect(Labels.shortId("8f3c2a1e-0000-4000-8000-000000000001")).toBe("8f3c2a1e…")
    expect(Labels.shortId("2251799813685249")).toBe("…13685249")
    expect(Labels.shortId("123456789012")).toBe("123456789012")
    expect(Labels.shortId("ORD-1")).toBe("ORD-1")
    expect(Labels.shortId("fake-ORD-1002")).toBe("fake-ORD-1002")
  })

  test("format in English with a 24-hour clock, whatever the system speaks", () => {
    expect(Labels.plural(1234, "instance")).toBe("1,234 instances")
    expect(Labels.count(15_234)).toBe("15,234")
    expect(getFormatLocale()).toEqual({ language: "en", locale: "en-u-hc-h23" })
  })

  test("write a count to type as the digits the dialog takes, in the prompt's noun too", () => {
    expect(BulkRequests.countPrompt(1000, "cancel")).toBe("Type 1000 to cancel 1000 instances")
    expect(BulkRequests.countPrompt(1, "migrate")).toBe("Type 1 to migrate 1 instance")
  })

  test("name a duration in its two largest units, as the MCP widgets do", () => {
    expect(Labels.duration(-5)).toBe("0ms")
    expect(Labels.duration(742)).toBe("742ms")
    expect(Labels.duration(4_200)).toBe("4s")
    expect(Labels.duration(187_000)).toBe("3m 7s")
    expect(Labels.duration(7_500_000)).toBe("2h 5m")
    expect(Labels.duration(97_200_000)).toBe("1d 3h")
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

  test("group a count from a thousand on, as the engine overview's table does", async () => {
    const summary = {
      latest: { id: "big:1", bpmnProcessId: "big", version: 3 },
      running: 15_234,
      withIncident: 0,
    }
    const runtime = { listDefinitions: () => Promise.resolve([summary]) }
    const [node] = await new DefinitionNodes(runtime as never).list()
    expect(node?.description).toBe("15,234 running in all versions · latest v3")
  })
})
