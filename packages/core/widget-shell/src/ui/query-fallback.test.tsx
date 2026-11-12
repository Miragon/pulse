// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { LocaleProvider } from "@miragon/pulse-ui"
import { QueryFallback, TableSkeleton } from "./query-fallback.js"

afterEach(cleanup)

const SKELETON = <div>loading skeleton</div>

describe("QueryFallback: never an eternal skeleton, never a dead end (U1, U22)", () => {
  it("renders the skeleton under a polite status while the query has not errored", () => {
    render(<QueryFallback isError={false} onRetry={vi.fn()} skeleton={SKELETON} />)
    expect(screen.getByText("loading skeleton").closest('[aria-hidden="true"]')).toBeTruthy()
    expect(screen.getByRole("status").textContent).toContain("Loading view…")
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("names the loading in the caller's words", () => {
    render(
      <QueryFallback isError={false} onRetry={vi.fn()} loadingText="Jobs…" skeleton={SKELETON} />,
    )
    expect(screen.getByRole("status").textContent).toContain("Jobs…")
  })

  it("says what happened and what to do, the raw cause under Details, and retries", () => {
    const onRetry = vi.fn()
    render(
      <QueryFallback
        isError
        error={new Error("engine prod unreachable (ECONNREFUSED)")}
        onRetry={onRetry}
        errorTitle="Could not load the process definitions"
        skeleton={SKELETON}
      />,
    )
    expect(screen.getByRole("heading", { name: "Engine prod is unreachable" })).toBeTruthy()
    expect(
      screen.getByText("Check that the engine is running, or pick another engine."),
    ).toBeTruthy()
    expect(
      screen.getByText("engine prod unreachable (ECONNREFUSED)").closest("details"),
    ).toBeTruthy()
    expect(screen.queryByText("loading skeleton")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("a refused engine says why in the active locale, and offers no Try again", () => {
    const refused =
      '[ENGINE_PROFILE_REFUSED] Engine "locked" is configured, but its profile cannot be used: auth.tokenEnv names a variable that is not set. Ask whoever runs this server to fix it.'
    render(
      <LocaleProvider locale="de">
        <QueryFallback isError error={new Error(refused)} onRetry={vi.fn()} skeleton={SKELETON} />
      </LocaleProvider>,
    )
    expect(
      screen.getByRole("heading", {
        name: "Die Engine locked ist nicht nutzbar: ihr Profil ist abgelehnt",
      }),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Erneut versuchen" })).toBeNull()
  })

  it("heads an unclassified error with the caller's title, in the active locale", () => {
    render(
      <LocaleProvider locale="de">
        <QueryFallback
          isError
          error="nicht klassifizierbar"
          onRetry={vi.fn()}
          errorTitle="Die Liste konnte nicht geladen werden"
          skeleton={SKELETON}
        />
      </LocaleProvider>,
    )
    expect(
      screen.getByRole("heading", { name: "Die Liste konnte nicht geladen werden" }),
    ).toBeTruthy()
    expect(
      screen.getByText("Versuch es noch mal. Klappt es wieder nicht, frag im Chat nach."),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeTruthy()
  })

  it("without a title or a cause still offers what to do and the retry", () => {
    render(<QueryFallback isError onRetry={vi.fn()} skeleton={SKELETON} />)
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeTruthy()
    expect(screen.getByRole("alert").querySelector("details")).toBeNull()
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })
})

describe("TableSkeleton", () => {
  it("draws a card with two bars", () => {
    const { container } = render(<TableSkeleton />)
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2)
  })
})
