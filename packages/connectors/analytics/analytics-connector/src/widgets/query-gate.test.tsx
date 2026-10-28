// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { LocaleProvider } from "@miragon/mcp-toolkit-ui"
import { QueryGate } from "./query-gate.js"

afterEach(cleanup)

// U1: the gate's own title heads only a failure the kit cannot classify.
describe("QueryGate", () => {
  function renderGate(error: Error, refetch = vi.fn()) {
    render(
      <LocaleProvider locale="de">
        <QueryGate
          initialData={null}
          query={{ data: undefined, isError: true, error, refetch }}
          skeleton={<div />}
        >
          {() => <p>data</p>}
        </QueryGate>
      </LocaleProvider>,
    )
    return refetch
  }

  it("says Prometheus is unreachable and what to do, and retries the query", () => {
    const refetch = renderGate(new Error("Prometheus unreachable (ECONNREFUSED)"))
    expect(screen.getByRole("heading", { name: "Prometheus ist nicht erreichbar" })).toBeTruthy()
    expect(screen.getByText("Prüf, ob Prometheus läuft und erreichbar ist.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it("heads a failure the kit cannot classify with the module's own words", () => {
    renderGate(new Error("odd"))
    expect(
      screen.getByRole("heading", { name: "Die Kennzahlen konnten nicht geladen werden." }),
    ).toBeTruthy()
  })

  it("renders its children once data exists", () => {
    render(
      <QueryGate
        initialData={{ n: 1 }}
        query={{ data: undefined, isError: false, refetch: vi.fn() }}
        skeleton={<div />}
      >
        {(data) => <p>n = {data.n}</p>}
      </QueryGate>,
    )
    expect(screen.getByText("n = 1")).toBeTruthy()
  })
})
