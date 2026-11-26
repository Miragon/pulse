// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { NavigationFocus } from "./navigation-focus.js"

/**
 * #344 N107: a client-side navigation moves focus to the new view's heading, which a screen reader
 * then reads; no live region repeats it.
 */
afterEach(cleanup)

const frameOf = () => screen.getByText("view body").parentElement as HTMLElement

function View({ viewKey, heading }: { viewKey: string; heading?: string }) {
  return (
    <NavigationFocus viewKey={viewKey}>
      {heading !== undefined && <h1>{heading}</h1>}
      <p>view body</p>
    </NavigationFocus>
  )
}

describe("NavigationFocus", () => {
  it("takes no focus when the view only opened", () => {
    render(<View viewKey="overview" heading="prod-a · Overview" />)
    expect(document.activeElement).toBe(document.body)
    expect(frameOf().getAttribute("tabindex")).toBe("-1")
    expect(screen.getByRole("heading").hasAttribute("tabindex")).toBe(false)
  })

  it("moves focus to the new view's heading after a navigation, with no live region", () => {
    const { rerender } = render(<View viewKey="overview" heading="prod-a · Overview" />)
    rerender(<View viewKey="incidents" heading="prod-a · Incidents" />)
    const heading = screen.getByRole("heading", { name: "prod-a · Incidents" })
    expect(document.activeElement).toBe(heading)
    expect(heading.getAttribute("tabindex")).toBe("-1")
    expect(screen.queryByRole("status")).toBeNull()
    // It draws no ring: the heading is read, not operated.
    expect(heading.style.outlineStyle).toBe("none")
  })

  it("lays its frame out in its parent as the page asks, a screen's flex column say", () => {
    render(
      <NavigationFocus viewKey="overview" className="flex min-h-0 flex-1 flex-col">
        <p>view body</p>
      </NavigationFocus>,
    )
    expect(frameOf().className).toBe("min-w-0 outline-none flex min-h-0 flex-1 flex-col")
  })

  it("keeps a heading's own tab order", () => {
    const { rerender } = render(
      <NavigationFocus viewKey="overview">
        <p>view body</p>
      </NavigationFocus>,
    )
    rerender(
      <NavigationFocus viewKey="incidents">
        <h1 tabIndex={0}>Incidents</h1>
        <p>view body</p>
      </NavigationFocus>,
    )
    expect(screen.getByRole("heading").getAttribute("tabindex")).toBe("0")
    expect(document.activeElement).toBe(screen.getByRole("heading"))
  })

  it("holds focus on the frame until a heading drawn later shows, then hands it on", async () => {
    const { rerender } = render(<View viewKey="overview" heading="Overview" />)
    rerender(<View viewKey="incidents" />)
    expect(document.activeElement).toBe(frameOf())
    rerender(<View viewKey="incidents" heading="Incidents" />)
    await act(async () => await Promise.resolve())
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Incidents" }))
  })

  it("hands focus on when the heading it took is replaced, as a route's guard by its loaded view", async () => {
    // The guard and the loaded view are different elements: the guard's heading leaves the document.
    const route = (viewKey: string, loaded: boolean) => (
      <NavigationFocus viewKey={viewKey}>
        {loaded ? (
          <section>
            <h1>prod-a · Instance</h1>
          </section>
        ) : (
          <header>
            <h1>prod-a · Instance</h1>
          </header>
        )}
        <p>view body</p>
      </NavigationFocus>
    )
    const { rerender } = render(route("overview", true))
    rerender(route("instance", false))
    const guard = screen.getByRole("heading")
    expect(document.activeElement).toBe(guard)
    rerender(route("instance", true))
    await act(async () => await Promise.resolve())
    const loaded = screen.getByRole("heading")
    expect(loaded).not.toBe(guard)
    expect(document.activeElement).toBe(loaded)
    // It keeps watching while its heading holds focus: the next replacement hands it on too.
    rerender(route("instance", false))
    await act(async () => await Promise.resolve())
    expect(document.activeElement).toBe(screen.getByRole("heading"))
  })

  it("holds focus on the frame when a heading it took leaves with none in its place", async () => {
    const { rerender } = render(<View viewKey="overview" heading="Overview" />)
    rerender(<View viewKey="incidents" heading="Incidents" />)
    expect(document.activeElement).toBe(screen.getByRole("heading"))
    rerender(<View viewKey="incidents" />)
    await act(async () => await Promise.resolve())
    expect(document.activeElement).toBe(frameOf())
    rerender(<View viewKey="incidents" heading="Incidents" />)
    await act(async () => await Promise.resolve())
    expect(document.activeElement).toBe(screen.getByRole("heading"))
  })

  it("leaves a replaced heading alone once the reader moved on", async () => {
    const route = (viewKey: string, loaded: boolean) => (
      <NavigationFocus viewKey={viewKey}>
        <button type="button">act</button>
        {loaded ? (
          <section>
            <h1>Instance</h1>
          </section>
        ) : (
          <header>
            <h1>Instance</h1>
          </header>
        )}
        <p>view body</p>
      </NavigationFocus>
    )
    const { rerender } = render(route("overview", true))
    rerender(route("instance", false))
    screen.getByRole("button", { name: "act" }).focus()
    rerender(route("instance", true))
    await act(async () => await Promise.resolve())
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "act" }))
  })

  it("leaves a heading drawn later alone once the reader moved on", async () => {
    const { rerender } = render(
      <NavigationFocus viewKey="overview">
        <h1>Overview</h1>
        <p>view body</p>
      </NavigationFocus>,
    )
    rerender(
      <NavigationFocus viewKey="incidents">
        <button type="button">act</button>
        <p>view body</p>
      </NavigationFocus>,
    )
    screen.getByRole("button", { name: "act" }).focus()
    rerender(
      <NavigationFocus viewKey="incidents">
        <button type="button">act</button>
        <h1>Incidents</h1>
        <p>view body</p>
      </NavigationFocus>,
    )
    await act(async () => await Promise.resolve())
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "act" }))
  })

  it("leaves focus where it is while the same view re-renders", () => {
    const { rerender } = render(
      <NavigationFocus viewKey="overview">
        <button type="button">act</button>
        <p>view body</p>
      </NavigationFocus>,
    )
    screen.getByRole("button", { name: "act" }).focus()
    rerender(
      <NavigationFocus viewKey="overview">
        <button type="button">act</button>
        <p>view body</p>
      </NavigationFocus>,
    )
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "act" }))
  })
})
