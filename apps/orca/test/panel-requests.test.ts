import { describe, expect, test, vi } from "vitest"
import { PanelRequests, type PanelParts } from "../src/worker/panel-requests.js"
import { Prompts } from "../src/worker/prompts.js"
import { EDITOR_FRAME, FakeOrca, PULSE_PANEL } from "./fake-orca.js"

class Harness {
  readonly orca = new FakeOrca()
  readonly prompts = new Prompts(() => undefined)

  constructor() {
    new PanelRequests(this.orca.api(), {
      prompts: this.prompts,
      live: { show: vi.fn() },
    } as unknown as PanelParts).register()
  }

  pending(): string {
    void this.prompts.ask({ kind: "confirm", title: "Retry?", facts: [], confirmLabel: "Retry" })
    return this.prompts.list()[0]?.id ?? ""
  }
}

describe("answering a prompt", () => {
  test("only the Pulse panel may confirm a write", () => {
    const harness = new Harness()
    const id = harness.pending()
    const answer = { id, answer: { kind: "confirm", confirmed: true } }

    expect(harness.orca.request("prompts.answer", answer, EDITOR_FRAME)).toEqual({ ok: false })
    expect(
      harness.orca.request("prompts.answer", answer, { ...PULSE_PANEL, contributionId: "other" }),
    ).toEqual({
      ok: false,
    })
    expect(harness.prompts.list()).toHaveLength(1)
    expect(harness.orca.request("prompts.answer", answer, PULSE_PANEL)).toEqual({ ok: true })
    expect(harness.prompts.list()).toHaveLength(0)
  })

  test("a refused answer is logged with the surface that sent it", () => {
    const harness = new Harness()
    const id = harness.pending()

    harness.orca.request(
      "prompts.answer",
      { id, answer: { kind: "confirm", confirmed: true } },
      EDITOR_FRAME,
    )

    expect(harness.orca.logs).toContain("prompt answer refused from editor pulse-view")
  })
})
