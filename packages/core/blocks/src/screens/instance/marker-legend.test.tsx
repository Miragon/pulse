// @vitest-environment happy-dom
import { cleanup, render, within } from "@testing-library/react"
import { LocaleProvider } from "@miragon/pulse-ui"
import { afterEach, describe, expect, it } from "vitest"
import { MarkerLegend, type MarkerSwatchProps } from "./marker-legend.js"

afterEach(cleanup)

function Swatch({ kind }: MarkerSwatchProps) {
  return <span data-swatch={kind} />
}

function legendOf(takenFlows?: boolean, locale = "en") {
  const { container } = render(
    <LocaleProvider locale={locale}>
      <MarkerLegend Swatch={Swatch} {...(takenFlows === undefined ? {} : { takenFlows })} />
    </LocaleProvider>,
  )
  const toggle = within(container).getByRole("button")
  const popover = container.querySelector<HTMLElement>("[popover]")
  return { toggle, popover }
}

describe("the legend of an instance's markers", () => {
  it("says what each marker means, each after the surface's sample of it", () => {
    const { toggle, popover } = legendOf()

    expect([toggle.getAttribute("aria-label"), toggle.title]).toEqual(["Legend", "Legend"])
    expect(popover?.textContent).toBe(
      "waiting hereincident hereincident in a called instancealready done",
    )
    expect(
      [...(popover?.querySelectorAll<HTMLElement>("[data-swatch]") ?? [])].map(
        (swatch) => swatch.dataset.swatch,
      ),
    ).toEqual(["waiting", "incident", "incidentInCalledInstance", "completed"])
  })

  it("names the flows taken where the surface draws them", () => {
    expect(legendOf(true).popover?.textContent).toBe(
      "waiting hereincident hereincident in a called instancealready done; green lines are the flows it took",
    )
  })

  it("speaks German under a German locale", () => {
    const { toggle, popover } = legendOf(true, "de")

    expect(toggle.getAttribute("aria-label")).toBe("Legende")
    expect(popover?.textContent).toBe(
      "wartet hierIncident hierIncident in einer aufgerufenen Instanzschon erledigt; grüne Linien zeigen die Sequenzflüsse, die die Instanz genommen hat",
    )
  })
})
