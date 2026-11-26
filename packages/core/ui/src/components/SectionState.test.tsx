// @vitest-environment happy-dom
import { StrictMode, useState, type ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { SKELETON_DELAY_MS } from "../hooks/use-elapsed.js"
import { LocaleProvider } from "../locale/locale-provider.js"
import type { SectionFailure } from "../locale/page-errors.js"
import { UI_MESSAGES } from "../locale/ui-messages.js"
import {
  SectionState,
  SectionStateGroup,
  type SectionStateProps,
  type SectionStateValue,
} from "./SectionState.js"

/**
 * SectionState, one section's read on a dashboard: the skeleton after 400 ms, the content, an
 * empty read, a failure with Try again unless no retry helps, a failed refresh over kept data;
 * under a SectionStateGroup a failure several sections share is said once.
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const en = UI_MESSAGES.en
const UNAVAILABLE: SectionFailure = {
  title: "Pulse doesn't answer",
  hint: "Try again in a moment.",
  details: "fetch failed: ECONNREFUSED",
}

function Section<T>(props: Partial<SectionStateProps<T>> & { state: SectionStateValue<T> }) {
  return (
    <SectionState onRetry={() => {}} {...props}>
      {props.children ?? ((data: T) => <p>{JSON.stringify(data)}</p>)}
    </SectionState>
  )
}

const root = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-slot='section-state']")!
const errorBoxes = (container: HTMLElement) =>
  container.querySelectorAll("[data-slot='error-state']")

describe("SectionState: the first read", () => {
  it("holds the skeleton's room, busy, and shows it only after 400 ms", () => {
    vi.useFakeTimers()
    const { container } = render(
      <Section state={{ loading: true }} skeleton={<div data-testid="shape" className="h-40" />} />,
    )
    const region = root(container)
    expect(region.getAttribute("data-state")).toBe("loading")
    expect(region.getAttribute("aria-busy")).toBe("true")
    // A screen reader that reaches the section hears that it loads; nothing is announced.
    expect(region.querySelector(".sr-only")?.textContent).toBe(en.common.loading)
    expect(region.querySelector("[role]")).toBeNull()
    const skeleton = region.querySelector("[data-skeleton]")!
    expect(skeleton.getAttribute("aria-hidden")).toBe("true")
    expect(skeleton.getAttribute("class")).toContain("invisible")
    expect(screen.getByTestId("shape")).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS - 1)
    })
    expect(skeleton.getAttribute("data-skeleton")).toBe("false")
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(skeleton.getAttribute("data-skeleton")).toBe("true")
    expect(skeleton.getAttribute("class")).not.toContain("invisible")
  })

  it("waits for a read that has neither data nor a failure yet, with a default skeleton", () => {
    const { container } = render(<Section state={{}} />)
    expect(root(container).getAttribute("data-state")).toBe("loading")
    expect(container.querySelector("[data-slot='skeleton']")).toBeTruthy()
  })

  it("starts the delay again for the next first read, after a failure", () => {
    vi.useFakeTimers()
    const { container, rerender } = render(<Section state={{ loading: true }} />)
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS)
    })
    rerender(<Section state={{ error: UNAVAILABLE }} />)
    rerender(<Section state={{ loading: true }} />)
    expect(container.querySelector("[data-skeleton]")?.getAttribute("data-skeleton")).toBe("false")
  })
})

describe("SectionState: content, nothing found", () => {
  it("renders the content, its region busy while a read runs over it", () => {
    const { container, rerender } = render(<Section state={{ data: { open: 3 } }} />)
    expect(screen.getByText('{"open":3}')).toBeTruthy()
    expect(root(container).getAttribute("data-state")).toBe("ready")
    expect(root(container).hasAttribute("aria-busy")).toBe(false)
    rerender(<Section state={{ loading: true, data: { open: 3 } }} />)
    expect(root(container).getAttribute("aria-busy")).toBe("true")
    expect(screen.getByText('{"open":3}')).toBeTruthy()
  })

  it("shows `empty` for null and an empty list, and for what isEmpty calls nothing", () => {
    const empty = <p>No open tasks</p>
    render(<Section state={{ data: null }} empty={empty} />)
    expect(screen.getByText("No open tasks")).toBeTruthy()
    cleanup()
    render(<Section state={{ data: [] }} empty={empty} />)
    expect(screen.getByText("No open tasks")).toBeTruthy()
    cleanup()
    render(
      <Section state={{ data: { total: 0 } }} empty={empty} isEmpty={(data) => data.total === 0} />,
    )
    expect(screen.getByText("No open tasks")).toBeTruthy()
    cleanup()
    render(<Section state={{ data: [1] }} empty={empty} />)
    expect(screen.getByText("[1]")).toBeTruthy()
  })

  it("leaves an empty list to the content and null to nothing without `empty`", () => {
    render(<Section state={{ data: [] }} />)
    expect(screen.getByText("[]")).toBeTruthy()
    cleanup()
    const { container } = render(<Section state={{ data: null }} />)
    expect(root(container).textContent).toBe("")
  })
})

describe("SectionState: a failure", () => {
  it("replaces a section without data with the status box: words, Details, Try again", () => {
    const onRetry = vi.fn()
    const { container } = render(<Section state={{ error: UNAVAILABLE }} onRetry={onRetry} />)
    expect(root(container).getAttribute("data-state")).toBe("error")
    const [box] = errorBoxes(container)
    expect(box?.getAttribute("data-variant")).toBe("block")
    // The section's own heading stays its one: the failure's title is a paragraph.
    expect(box?.querySelector("p")?.textContent).toBe(UNAVAILABLE.title)
    expect(box?.textContent).toContain(UNAVAILABLE.hint)
    expect(box?.querySelector("details pre")?.textContent).toBe(UNAVAILABLE.details)
    fireEvent.click(screen.getByRole("button", { name: en.common.retry }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("keeps keyboard focus in the section when its Try again succeeds, the button gone", () => {
    const { container, rerender } = render(<Section state={{ error: UNAVAILABLE }} />)
    const button = screen.getByRole("button", { name: en.common.retry })
    button.focus()
    fireEvent.click(button)
    rerender(<Section state={{ data: { open: 3 } }} />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(document.activeElement).toBe(root(container))
    expect(root(container).tabIndex).toBe(-1)
  })

  it("leaves focus where the reader moved it while the retry ran", () => {
    const { rerender } = render(
      <>
        <Section state={{ error: UNAVAILABLE }} />
        <input aria-label="elsewhere" />
      </>,
    )
    const button = screen.getByRole("button", { name: en.common.retry })
    button.focus()
    fireEvent.click(button)
    const elsewhere = screen.getByRole("textbox", { name: "elsewhere" })
    elsewhere.focus()
    rerender(
      <>
        <Section state={{ data: { open: 3 } }} />
        <input aria-label="elsewhere" />
      </>,
    )
    expect(document.activeElement).toBe(elsewhere)
  })

  it("offers no Try again for a refusal no retry changes", () => {
    render(<Section state={{ error: { ...UNAVAILABLE, permanent: true } }} />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText(UNAVAILABLE.title)).toBeTruthy()
  })

  it("keeps the failure while its retry runs, the region busy", () => {
    const { container } = render(<Section state={{ loading: true, error: UNAVAILABLE }} />)
    expect(root(container).getAttribute("aria-busy")).toBe("true")
    expect(errorBoxes(container)).toHaveLength(1)
  })

  it("keeps the data of the last good read and says the failure inline above it", () => {
    const { container } = render(
      <LocaleProvider locale="de">
        <Section state={{ data: { open: 3 }, error: UNAVAILABLE }} errorTitleAs="h3" />
      </LocaleProvider>,
    )
    const region = root(container)
    expect(region.getAttribute("data-state")).toBe("stale")
    const [box] = errorBoxes(container)
    expect(box?.getAttribute("data-variant")).toBe("inline")
    expect(box?.querySelector("h3")?.textContent).toBe(UNAVAILABLE.title)
    expect(box?.textContent).toContain(`${UNAVAILABLE.hint} ${UI_MESSAGES.de.sectionState.kept}`)
    // The failure first, the kept content after it.
    expect(region.firstElementChild).toBe(box)
    expect(region.textContent).toContain('{"open":3}')
  })

  it("says only that it keeps the data when the failure has no hint", () => {
    render(<Section state={{ data: [1], error: { title: "Failed" } }} />)
    expect(screen.getByText(en.sectionState.kept)).toBeTruthy()
  })
})

/** A section of a page whose failure the test sets and whose retries it counts. */
function Failing({
  name,
  failure,
  data,
  onRetry,
}: {
  name: string
  failure: SectionFailure | undefined
  data?: string
  onRetry: (name: string) => void
}) {
  return (
    <section aria-label={name}>
      <SectionState state={{ error: failure, data }} onRetry={() => onRetry(name)}>
        {(text) => <p>{text}</p>}
      </SectionState>
    </section>
  )
}

function Page({ children }: { children: ReactNode }) {
  return <SectionStateGroup>{children}</SectionStateGroup>
}

const section = (name: string) => screen.getByRole("region", { name })

describe("SectionStateGroup: a failure several sections share is said once", () => {
  it("lets the first in the document say it, the others a quiet line, one Try again for all", () => {
    const retried: string[] = []
    const onRetry = (name: string) => retried.push(name)
    render(
      <Page>
        <Failing name="KPIs" failure={UNAVAILABLE} onRetry={onRetry} />
        <Failing name="Per day" failure={UNAVAILABLE} onRetry={onRetry} data="kept rows" />
        <Failing name="Tasks" failure={UNAVAILABLE} onRetry={onRetry} />
      </Page>,
    )
    expect(section("KPIs").querySelectorAll("[data-slot='error-state']")).toHaveLength(1)
    expect(section("Per day").textContent).toBe(`${en.sectionState.sameFailureKept}kept rows`)
    expect(section("Tasks").textContent).toBe(en.sectionState.sameFailure)
    expect(screen.getAllByRole("button", { name: en.common.retry })).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: en.common.retry }))
    expect(retried.sort()).toEqual(["KPIs", "Per day", "Tasks"])
  })

  it("says failures that differ each, and a failure alone with its own retry", () => {
    const retried: string[] = []
    render(
      <Page>
        <Failing name="KPIs" failure={UNAVAILABLE} onRetry={(name) => retried.push(name)} />
        <Failing
          name="Tasks"
          failure={{ ...UNAVAILABLE, details: "HTTP 500" }}
          onRetry={(name) => retried.push(name)}
        />
      </Page>,
    )
    const buttons = screen.getAllByRole("button", { name: en.common.retry })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1])
    expect(retried).toEqual(["Tasks"])
  })

  it("passes the word to the next section once the first one reads again", () => {
    function Recovering() {
      const [first, setFirst] = useState<SectionFailure | undefined>(UNAVAILABLE)
      return (
        <Page>
          <Failing name="KPIs" failure={first} data="fresh" onRetry={() => setFirst(undefined)} />
          <Failing name="Tasks" failure={UNAVAILABLE} onRetry={() => {}} />
        </Page>
      )
    }
    render(<Recovering />)
    expect(section("Tasks").textContent).toBe(en.sectionState.sameFailure)
    // Its own Try again reads both again; only the first comes back.
    fireEvent.click(screen.getByRole("button", { name: en.common.retry }))
    expect(section("KPIs").textContent).toBe("fresh")
    expect(section("Tasks").querySelectorAll("[data-slot='error-state']")).toHaveLength(1)
  })

  it("orders by the document, not by which section failed first", () => {
    function Late() {
      const [failed, setFailed] = useState(false)
      return (
        <Page>
          <Failing
            name="KPIs"
            failure={failed ? UNAVAILABLE : undefined}
            data="kpis"
            onRetry={() => {}}
          />
          <Failing name="Tasks" failure={UNAVAILABLE} onRetry={() => {}} />
          <button type="button" onClick={() => setFailed(true)}>
            fail
          </button>
        </Page>
      )
    }
    render(<Late />)
    expect(section("Tasks").querySelectorAll("[data-slot='error-state']")).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "fail" }))
    expect(section("KPIs").querySelectorAll("[data-slot='error-state']")).toHaveLength(1)
    expect(section("Tasks").textContent).toBe(en.sectionState.sameFailure)
  })

  it("says it once under StrictMode's doubled effects too", () => {
    render(
      <StrictMode>
        <Page>
          <Failing name="KPIs" failure={UNAVAILABLE} onRetry={() => {}} />
          <Failing name="Tasks" failure={UNAVAILABLE} onRetry={() => {}} />
        </Page>
      </StrictMode>,
    )
    expect(screen.getAllByRole("button", { name: en.common.retry })).toHaveLength(1)
    expect(section("Tasks").textContent).toBe(en.sectionState.sameFailure)
  })

  it("lets every section say its own failure outside a group", () => {
    render(
      <>
        <Failing name="KPIs" failure={UNAVAILABLE} onRetry={() => {}} />
        <Failing name="Tasks" failure={UNAVAILABLE} onRetry={() => {}} />
      </>,
    )
    expect(screen.getAllByRole("button", { name: en.common.retry })).toHaveLength(2)
  })
})
