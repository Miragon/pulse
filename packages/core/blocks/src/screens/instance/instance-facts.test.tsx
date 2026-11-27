// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import type { CallerData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { InstanceFacts, type InstanceFactsData } from "./instance-facts.js"
import { SURFACES, editorInstanceSlots, pageInstanceSlots } from "./instance-slots.test-support.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const DISPATCH = WORLD_SCREENS.instance
const LABEL = WORLD_SCREENS.calledInstance

function factsOf(
  instance: InstanceFactsData,
  caller: CallerData | null,
  slots = editorInstanceSlots().slots,
  locale = "en",
) {
  const { container } = render(
    <LocaleProvider locale={locale}>
      <p data-testid="facts">
        <InstanceFacts engine="prod-a" instance={instance} caller={caller} slots={slots} />
      </p>
    </LocaleProvider>,
  )
  return within(container).getByTestId("facts")
}

describe.each(SURFACES)("an instance's facts with %s", (_surface, slotsOf) => {
  it("name the business key's id to copy, the version it runs and when it started, to the millisecond", () => {
    const { slots, asked } = slotsOf()
    const facts = factsOf(DISPATCH.instance, DISPATCH.caller, slots)

    expect(facts.textContent).toMatch(
      /^fake-DSP-3001Dispatch order v1Started (\w{3} \d{1,2}, )?08:00:00\.000$/,
    )
    within(facts).getByRole("button", { name: "Copy instance ID" }).click()
    fireEvent.click(within(facts).getByTitle("Show definition Dispatch order v1"))

    expect(asked.copied).toEqual([{ text: "fake-DSP-3001", label: "instance ID" }])
    expect(asked.opened).toEqual([
      {
        target: {
          kind: "version",
          engine: "prod-a",
          bpmnProcessId: "pulse-dispatch",
          version: 1,
          definitionId: "pulse-dispatch:1",
        },
        toSide: false,
      },
    ])
  })

  it("open the version an instance runs in its tenant, where its version names one", () => {
    const { slots, asked } = slotsOf()
    const definition = { ...DISPATCH.instance.definition, tenantId: "north" }
    const facts = factsOf({ ...DISPATCH.instance, definition }, null, slots)

    fireEvent.click(within(facts).getByTitle("Show definition Dispatch order v1"))

    expect(asked.opened.map(({ target }) => target)).toEqual([
      expect.objectContaining({
        kind: "version",
        bpmnProcessId: "pulse-dispatch",
        tenantId: "north",
      }),
    ])
  })

  it("name the caller by its business key and open it, the id staying out where the title is the id", () => {
    const { slots, asked } = slotsOf()
    const facts = factsOf(LABEL.instance, LABEL.caller, slots)
    const caller = within(facts).getByTitle("Open the calling instance fake-DSP-3001")

    fireEvent.click(caller)

    expect(within(facts).queryByRole("button", { name: "Copy instance ID" })).toBeNull()
    expect(caller.textContent).toBe("from DSP-3001")
    expect(caller.dataset.rel).toBe("caller")
    expect(asked.opened).toEqual([
      {
        target: { kind: "instance", engine: "prod-a", instanceId: "fake-DSP-3001" },
        toSide: false,
      },
    ])
  })
})

describe("an instance's facts", () => {
  it("name a caller its read did not find, or one without a business key, by its short id", () => {
    const unread = factsOf(LABEL.instance, { instanceId: "fake-DSP-3001", found: null })
    expect(within(unread).getByTitle("Open the calling instance fake-DSP-3001").textContent).toBe(
      "from fake-DSP-3001",
    )
    cleanup()

    const { found } = LABEL.caller ?? { found: null }
    const keyless = factsOf(LABEL.instance, {
      instanceId: "8f3c2a1e-4b7d-4c1a-9f0e-1d2c3b4a5e6f",
      found: found && { definition: found.definition, state: found.state },
    })
    expect(keyless.textContent).toContain("from 8f3c2a1e…")
  })

  it("take a surface's own words for the caller where its code names it", () => {
    const { container } = render(
      <InstanceFacts
        engine="prod-a"
        instance={LABEL.instance}
        caller={LABEL.caller}
        callerLabel="from fake-DSP-3001"
        slots={editorInstanceSlots().slots}
      />,
    )

    expect(
      within(container).getByTitle("Open the calling instance fake-DSP-3001").textContent,
    ).toBe("from fake-DSP-3001")
  })

  it("say when an ended instance ended, and nothing of a time an instance does not name", () => {
    const ended = factsOf(
      { ...DISPATCH.instance, endedAt: "2026-10-21T08:05:00.250Z" },
      null,
      pageInstanceSlots().slots,
    )
    expect(ended.textContent).toMatch(/Ended (\w{3} \d{1,2}, )?08:05:00\.250$/)
    cleanup()

    const { id, definition, businessKey } = DISPATCH.instance
    const unstarted = { id, definition, ...(businessKey === undefined ? {} : { businessKey }) }
    expect(factsOf(unstarted, null).textContent).toBe("fake-DSP-3001Dispatch order v1")
  })

  it("name a process without a name by its BPMN process ID", () => {
    const { id, bpmnProcessId, version } = DISPATCH.instance.definition
    const nameless = { id, bpmnProcessId, version }
    const facts = factsOf({ ...DISPATCH.instance, definition: nameless }, null)

    expect(within(facts).getByTitle("Show definition pulse-dispatch v1").textContent).toBe(
      "pulse-dispatch v1",
    )
  })

  it("speak German under a German locale", () => {
    const facts = factsOf(LABEL.instance, LABEL.caller, editorInstanceSlots().slots, "de")

    expect(facts.textContent).toMatch(/^Print label v1von DSP-3001Gestartet .*08:00:00[.,]000$/)
    expect(within(facts).getByTitle("Definition Print label v1 zeigen")).toBeTruthy()
    expect(within(facts).getByTitle("Aufrufende Instanz fake-DSP-3001 öffnen")).toBeTruthy()
    cleanup()
    const dispatch = factsOf(DISPATCH.instance, null, editorInstanceSlots().slots, "de")
    expect(within(dispatch).getByRole("button", { name: "Instanz-ID kopieren" })).toBeTruthy()
  })
})
