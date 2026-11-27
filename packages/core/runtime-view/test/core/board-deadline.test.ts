import { afterEach, describe, expect, test, vi } from "vitest"
import { BoardPanel } from "../../src/core/boards/board-panel.js"
import { badgeOf, boardFixture, stubbed, summary } from "./support/board-fixture.js"

const SHOP = stubbed({
  describeEngine: () => Promise.resolve({ product: "Engine", version: "7.24" }),
  listDefinitions: () => Promise.resolve([summary("order", 12, 3)]),
  countInstances: () => Promise.resolve({ count: 12 }),
})

const STUCK = stubbed({ describeEngine: () => new Promise<never>(() => undefined) })

afterEach(() => {
  vi.useRealTimers()
})

describe("a board whose engine does not answer", () => {
  test("shows it failed after the builder's 15 seconds, while the other engine's tiles read", async () => {
    vi.useFakeTimers()
    const counter = { widget: "counter", props: { filter: { process: "order" } } }
    const fixture = boardFixture(
      { title: "Payments", engines: ["shop", "stuck"], rows: [{ row: [counter] }] },
      [
        { name: "shop", runtime: SHOP },
        { name: "stuck", runtime: STUCK },
      ],
    )

    const loading = new BoardPanel(fixture.context).handle({ type: "ready" })
    await vi.advanceTimersByTimeAsync(14_999)

    expect(fixture.states).toEqual([])
    expect(fixture.calls.get("shop")).toContain("countInstances")
    await vi.advanceTimersByTimeAsync(1)
    await loading

    expect(fixture.view().engines).toEqual([
      expect.objectContaining({ name: "shop", state: "ready" }),
      {
        name: "stuck",
        state: "failed",
        badge: badgeOf("stuck"),
        problem: {
          title: "Can't reach stuck.",
          detail: "stuck did not answer the board's reads within 15000 ms.",
          canEditConnection: true,
        },
      },
    ])
    expect(fixture.view().rows[0]?.[0]).toMatchObject({
      kind: "counter",
      known: 1,
      readings: [{ engine: "shop", count: { count: 12 } }, { engine: "stuck" }],
    })
    expect(fixture.calls.get("stuck")).toEqual(["describeEngine"])
  })
})
