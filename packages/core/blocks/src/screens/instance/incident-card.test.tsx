// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { IncidentCard, type IncidentCardFields, type IncidentCardProps } from "./incident-card.js"
import { SURFACES, editorInstanceSlots } from "./instance-slots.test-support.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const [CALLED] = WORLD_SCREENS.instance.incidents
const JOB = "5c1d77a0-9e8f-4d7c-b6a5-4f3e2d1c0b9a"
const INCIDENT = "a4b5c6d7-e8f9-4a0b-9c1d-2e3f4a5b6c7d"
/** A copyable id's text: its short form, then the whole id a screen reader reads. */
const ID_FACT = `Incident: a4b5c6d7…${INCIDENT}`

const OWN: IncidentCardFields = {
  rootIncident: { id: INCIDENT },
  liesIn: null,
  elementId: "Activity_CallScoringApi",
  type: "failedJob",
  message: 'I/O error on POST "https://scoring.internal/score": Connection refused',
  createdAt: "2026-10-21T08:00:02.000Z",
  job: { id: JOB, type: "scoring-api" },
  rootCauseLine: "ConnectException: Connection refused",
  causeSource: "stacktrace",
}

function cardOf(
  card: IncidentCardFields,
  extra: Partial<Omit<IncidentCardProps, "card">> = {},
  locale = "en",
) {
  const { container } = render(
    <LocaleProvider locale={locale}>
      <IncidentCard
        engine="prod-a"
        card={card}
        elementName="Call scoring API"
        slots={editorInstanceSlots().slots}
        {...extra}
      />
    </LocaleProvider>,
  )
  return within(container).getByRole("article")
}

function factsOf(card: HTMLElement): string[] {
  return [...card.querySelectorAll("dt")].map(
    (term) => `${term.textContent}: ${term.nextElementSibling?.textContent ?? ""}`,
  )
}

describe.each(SURFACES)("an incident card with %s", (_surface, slotsOf) => {
  it("names a called instance's root incident, where it lies, its job, its retries and its id", () => {
    const { slots, asked } = slotsOf()
    const card = cardOf(CALLED!, { slots, elementName: "Render label" })

    fireEvent.click(within(card).getByTitle("Open called instance fake-label-of-DSP-3001"))
    within(card).getByRole("button", { name: "Copy incident ID" }).click()

    expect(card.getAttribute("aria-label")).toBe("Failed task at Render label")
    expect(card.querySelector("header")?.textContent).toMatch(
      /^Failed task · Render labelsince (\w{3} \d{1,2}, )?08:00 \(.+\)$/,
    )
    expect(factsOf(card)).toEqual([
      "Root cause: MissingBean: Cannot resolve identifier",
      "Located in: pulse-label fake-label-of-DSP-3001",
      "Job: job-of-fake-label-of-DSP-3001",
      "Retries left: 0No retries left",
      "Incident: incident-of-fake-label-of-DSP-3001",
    ])
    expect(asked.opened).toEqual([
      {
        target: { kind: "instance", engine: "prod-a", instanceId: "fake-label-of-DSP-3001" },
        toSide: false,
      },
    ])
    expect(asked.copied).toEqual([
      { text: "incident-of-fake-label-of-DSP-3001", label: "incident ID" },
    ])
  })
})

describe("an incident card", () => {
  it("names its message apart from a root cause that does not hold it, and the job's type", () => {
    const card = cardOf(OWN)

    expect(factsOf(card)).toEqual([
      "Root cause: ConnectException: Connection refused",
      `Message: ${OWN.message}`,
      `Job: 5c1d77a0…${JOB}scoring-api`,
      ID_FACT,
    ])
    expect(within(card).getByTitle("Job type").textContent).toBe("scoring-api")
  })

  it("labels the cause by its source, and a cause without a source as the cause", () => {
    expect(factsOf(cardOf({ ...OWN, causeSource: "workerError" }))[0]).toMatch(/^Worker error: /)
    cleanup()
    expect(factsOf(cardOf({ ...OWN, causeSource: "errorMessage" }))[0]).toMatch(/^Cause: /)
    cleanup()
    expect(factsOf(cardOf({ ...OWN, causeSource: null }))[0]).toMatch(/^Cause: /)
    cleanup()
    const { job, ...jobless } = OWN
    expect(job).toBeDefined()
    expect(factsOf(cardOf({ ...jobless, rootCauseLine: null, causeSource: null }))).toEqual([
      `Message: ${OWN.message}`,
      ID_FACT,
    ])
  })

  it("shows no retries left with the danger icon and its words, retries left as a neutral figure", () => {
    const none = cardOf({ ...OWN, retriesLeft: 0 })
    const alarm = none.querySelector<HTMLElement>('[data-slot="count-figure"]')

    expect(alarm?.dataset.tone).toBe("danger")
    expect(alarm?.querySelector("svg")).not.toBeNull()
    expect(alarm?.textContent).toBe("0No retries left")
    cleanup()
    const some = cardOf({ ...OWN, retriesLeft: 2 }).querySelector<HTMLElement>(
      '[data-slot="count-figure"]',
    )
    expect(some?.dataset.tone).toBe("neutral")
    expect(some?.querySelector("svg")).toBeNull()
    expect(some?.textContent).toBe("2")
    cleanup()
    expect(factsOf(cardOf({ ...OWN, retriesLeft: 0 }, {}, "de"))).toContain(
      "Verbleibende Versuche: 0Keine Versuche mehr",
    )
  })

  it("links a called instance whose process the screen does not name by its short id alone", () => {
    const card = cardOf({ ...CALLED!, liesIn: { instanceId: "c-1" } })

    expect(within(card).getByTitle("Open called instance c-1").textContent).toBe(" c-1")
  })

  it("puts the surface's facts before its id, and its way to the text before its actions", () => {
    const card = cardOf(OWN, {
      facts: [{ id: "model", label: "Model", value: "credit-scoring.bpmn" }],
      detail: <button type="button">Open stacktrace</button>,
      actions: <button type="button">Retry</button>,
    })

    expect(factsOf(card).slice(-2)).toEqual(["Model: credit-scoring.bpmn", ID_FACT])
    expect(
      within(card)
        .getAllByRole("button")
        .map((button) => button.textContent)
        .slice(-2),
    ).toEqual(["Open stacktrace", "Retry"])
  })

  it("speaks German, the engine's own incident types in German words and any other in the engine's", () => {
    const card = cardOf(OWN, {}, "de")

    expect(card.getAttribute("aria-label")).toBe("Fehlgeschlagener Job an Call scoring API")
    expect(card.querySelector("header")?.textContent).toMatch(
      /^Fehlgeschlagener Job · Call scoring APIseit /,
    )
    expect(factsOf(card).map((fact) => fact.split(":")[0])).toEqual([
      "Grundursache",
      "Meldung",
      "Job",
      "Incident",
    ])
    cleanup()
    expect(
      cardOf({ ...CALLED!, type: "JOB_NO_RETRIES" }, {}, "de").getAttribute("aria-label"),
    ).toBe("Job ohne Versuche an Call scoring API")
    cleanup()
    expect(cardOf({ ...CALLED!, causeSource: "workerError" }, {}, "de").textContent).toContain(
      "Liegt in",
    )
    cleanup()
    expect(cardOf(CALLED!, {}, "de").getAttribute("aria-label")).toBe(
      "Failed task an Call scoring API",
    )
  })
})
