import { FakeEngine, FakeWorld, PatchedRuntime } from "@miragon/pulse-engine-core/testing"
import { describe, expect, test } from "vitest"
import { BoardBuilder, BoardJson, type BoardReads } from "../../src/builder/index.js"
import { BuilderWorld } from "./support/engines.js"

const SHOP = "shop"

function withTenants() {
  return new FakeEngine(FakeWorld.seedWithTenants().state)
}

async function built(widget: unknown, reads: BoardReads = withTenants()) {
  const board = BuilderWorld.board([widget], [SHOP])
  const model = await BoardBuilder.build(board, [{ name: SHOP, reads }])
  return BoardJson.of(model, { failureOf: () => ({ code: "unknown" }), notes: [] })
}

describe("a board over an engine with tenants", () => {
  test("sums the instances with incident per process, a key in each tenant apart", async () => {
    const engine = withTenants()
    const failing = new PatchedRuntime(engine, {
      listDefinitions: async () =>
        (await engine.listDefinitions()).map((summary) => ({ ...summary, withIncident: 1 })),
    })

    const data = await built({ widget: "incidentSummary", props: { groupBy: "process" } }, failing)
    const [tile] = data.rows.flat()

    const rows = tile?.kind === "incidentSummary" ? tile.rows : []
    const labels = rows.filter(({ process }) => process?.bpmnProcessId === "pulse-label")
    expect(labels.map(({ process }) => [process?.tenantId, process?.version])).toEqual([
      [undefined, 1],
      ["pulse-north", 1],
      ["pulse-south", 2],
    ])
    expect(labels[0]?.process).not.toHaveProperty("tenantId")
  })

  test("draws the key's process without a tenant where one is deployed", async () => {
    const data = await built({
      widget: "processDiagram",
      props: { engines: [SHOP], process: "pulse-label" },
    })
    const [tile] = data.rows.flat()

    expect(tile).toMatchObject({ kind: "processDiagram", latest: { version: 1 } })
    expect(tile?.kind === "processDiagram" && tile.latest).not.toHaveProperty("tenantId")
  })

  test("draws the key's process of the first tenant by id where every one has a tenant", async () => {
    const engine = withTenants()
    const tenantsOnly = new PatchedRuntime(engine, {
      listDefinitions: async () =>
        (await engine.listDefinitions())
          .filter(({ latest }) => latest.tenantId !== null)
          .toReversed(),
    })

    const data = await built(
      { widget: "processDiagram", props: { engines: [SHOP], process: "pulse-label" } },
      tenantsOnly,
    )
    const [tile] = data.rows.flat()

    expect(tile).toMatchObject({
      kind: "processDiagram",
      latest: { bpmnProcessId: "pulse-label", tenantId: "pulse-north", version: 1 },
    })
  })
})
