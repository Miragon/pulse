import { BpmnProcessId, DefinitionId, TenantId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { BoardPanel } from "../../src/core/boards/board-panel.js"
import { boardFixture, stubbed, summary } from "./support/board-fixture.js"

function inTenant(tenant: string, withIncident: number) {
  const row = summary("label", 2, withIncident)
  return {
    ...row,
    latest: { ...row.latest, id: DefinitionId(`label:${tenant}`), tenantId: TenantId(tenant) },
  }
}

const SHOP = stubbed({
  describeEngine: () => Promise.resolve({ product: "Engine", version: "7.24" }),
  listDefinitions: () => Promise.resolve([inTenant("north", 2), inTenant("south", 3)]),
})

const SUMMARY = { widget: "incidentSummary", props: { groupBy: "process" } }

async function opened() {
  const board = { title: "Labels", engines: ["shop"], rows: [{ row: [SUMMARY] }] }
  const fixture = boardFixture(board, [{ name: "shop", runtime: SHOP }])
  const panel = new BoardPanel(fixture.context)
  await panel.handle({ type: "ready" })
  return { fixture, panel }
}

describe("an incident summary per process over a key in two tenants, a row each (F17)", () => {
  test("targets a row per tenant, each naming its tenant", async () => {
    const { fixture } = await opened()

    const [tile] = fixture.view().rows[0] ?? []
    const targets = tile?.kind === "incidentSummary" ? tile.targets : []
    expect(targets.map(({ bpmnProcessId, tenantId }) => [bpmnProcessId, tenantId])).toEqual([
      ["label", "south"],
      ["label", "north"],
    ])
  })

  test("opens the process panel of a row's own tenant, never a tenant no row names", async () => {
    const { fixture, panel } = await opened()
    const open = (tenantId?: string) =>
      panel.handle({
        type: "openBoardProcess",
        engine: "shop",
        bpmnProcessId: "label",
        ...(tenantId === undefined ? {} : { tenantId }),
        filter: { scope: "withIncident" },
        toSide: false,
      })

    await open("south")
    await open("east")
    await open()

    expect(fixture.navigation.openDefinition.mock.calls).toEqual([
      [
        "shop",
        { bpmnProcessId: BpmnProcessId("label"), tenantId: TenantId("south") },
        { scope: "withIncident" },
        { toSide: false },
      ],
    ])
  })
})
