// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { LocaleProvider, PagedListFooter } from "@miragon/pulse-ui"
import { NO_FIT_ROWS } from "./inline-fit.js"
import { PagedRows } from "./paged-rows.js"
import { createTestQueryClient, TestViewHost } from "./test-view-host.js"
import { usePagedViewData, type PagedViewData } from "./use-paged-view-data.js"

afterEach(() => cleanup())

function paged(overrides: Partial<PagedViewData<string, object>> = {}) {
  return {
    items: ["a", "b"],
    firstPage: {},
    total: 3,
    stale: false,
    hasMore: true,
    loadMore: vi.fn(),
    loading: false,
    refreshing: false,
    loadingMore: false,
    error: null,
    retry: vi.fn(),
    loadMoreError: null,
    fit: NO_FIT_ROWS,
    footerLabels: undefined,
    ...overrides,
  } satisfies PagedViewData<string, object>
}

const footerOf = (status: HTMLElement) => status.closest('[data-slot="list-footer"]')!

function renderList(state: PagedViewData<string, object>) {
  render(
    <>
      <PagedRows paged={state}>
        <p>rows</p>
      </PagedRows>
      <PagedListFooter paged={state} noun="items" />
    </>,
  )
  return { rows: screen.getByText("rows").parentElement!, status: screen.getByRole("status") }
}

/**
 * A stale list must be SEEN as stale, and no "Showing X of Y" may pair the
 * previous count with the new search (#341 review). ONE live region: the footer.
 */
describe("PagedListFooter + PagedRows: the stale and in-flight states", () => {
  it("a settled page: the count in the one live region, rows not marked", () => {
    const { rows, status } = renderList(paged())
    expect(screen.getAllByRole("status")).toHaveLength(1)
    expect(status.textContent).toBe("Showing 2 of 3 items")
    expect(footerOf(status).className).not.toContain("sr-only")
    expect(rows.getAttribute("aria-busy")).toBe("false")
    expect(rows.hasAttribute("data-stale")).toBe(false)
    expect(rows.querySelector("[data-tone]")).toBeNull()
    expect(rows.className).not.toContain("opacity")
  })

  it("a new search in flight: a VISIBLE Updating… line, busy rows marked info, no count", () => {
    const { rows, status } = renderList(paged({ stale: true, refreshing: true, hasMore: false }))
    expect(footerOf(status).className).not.toContain("sr-only")
    expect(status.textContent).toBe("Updating…")
    expect(rows.getAttribute("aria-busy")).toBe("true")
    expect(rows.getAttribute("data-stale")).toBe("true")
    expect(rows.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("info")
    expect(rows.className).not.toContain("opacity")
    expect(screen.queryByText(/Showing/)).toBeNull()
  })

  it("a failed search: the rows stay marked (warning), the failure says so, still no count", () => {
    const state = paged({ stale: true, hasMore: false, error: new Error("engine down") })
    const { rows, status } = renderList(state)
    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("Couldn't update the list")
    expect(alert.textContent).toContain("You're seeing the previous result.")
    // The raw reason sits under "Details", out of the sentence.
    expect(alert.querySelector("details pre")?.textContent).toBe("engine down")
    expect(alert.getAttribute("data-tone")).toBe("warning")
    expect(rows.getAttribute("data-stale")).toBe("true")
    expect(rows.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("warning")
    expect(footerOf(status).className).toBe("sr-only")
    expect(status.textContent).toBe("")
    expect(screen.queryByText(/Showing/)).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(state.retry).toHaveBeenCalledTimes(1)
    expect(state.loadMore).not.toHaveBeenCalled()
  })

  it("a same-filter refetch: Updating… is visible, the count of THIS filter stays", () => {
    const { rows, status } = renderList(paged({ refreshing: true }))
    expect(status.textContent).toBe("Showing 2 of 3 itemsUpdating…")
    expect(footerOf(status).className).not.toContain("sr-only")
    expect(rows.getAttribute("aria-busy")).toBe("true")
    expect(rows.hasAttribute("data-stale")).toBe(false)
  })

  it("a search that finds nothing: the live region stays and says so", () => {
    const { status } = renderList(paged({ items: [], total: 0, hasMore: false }))
    expect(status.textContent).toBe("No entries")
    expect(footerOf(status).className).toBe("sr-only")
  })
})

/** #339: without caller texts the footer follows the active locale. */
describe("PagedListFooter: the catalog follows the active locale", () => {
  function renderGerman(state: PagedViewData<string, object>) {
    render(
      <LocaleProvider locale="de">
        <PagedListFooter paged={state} noun="Einträge" />
      </LocaleProvider>,
    )
  }

  it("in flight: Wird aktualisiert…", () => {
    renderGerman(paged({ stale: true, refreshing: true, hasMore: false }))
    expect(screen.getByRole("status").textContent).toBe("Wird aktualisiert…")
  })

  it("a failed page 0 and a failed load-more, each with the German retry", () => {
    renderGerman(
      paged({
        stale: true,
        error: new Error("weg"),
        loadMoreError: new Error("Zeitüberschreitung"),
      }),
    )
    const [refresh, more] = screen.getAllByRole("alert")
    expect(refresh.textContent).toContain("Die Liste konnte nicht aktualisiert werden")
    expect(refresh.textContent).toContain("Du siehst das vorherige Ergebnis.")
    expect(refresh.querySelector("details pre")?.textContent).toBe("weg")
    expect(more.textContent).toContain("Weitere Einträge konnten nicht geladen werden")
    expect(more.querySelector("details pre")?.textContent).toBe("Zeitüberschreitung")
    expect(screen.getAllByRole("button", { name: "Erneut versuchen" })).toHaveLength(2)
  })
})

/**
 * End to end: the hook's state, passed whole as every cockpit list passes it, makes the footer
 * say why a refused engine cannot refresh the list, in the host's language, and offer no retry.
 */
describe("usePagedViewData + PagedListFooter: a refused engine", () => {
  interface Page {
    items: string[]
    total: number
  }
  const REFUSED =
    '[ENGINE_PROFILE_REFUSED] Engine "prod" is configured, but its profile is refused.'

  function RefusedList({ noun }: { noun: string }) {
    const paged = usePagedViewData<string, Page>({
      initialData: null,
      key: ["test:refused"],
      tool: "test_list_data",
      args: {},
      pageSize: 2,
      ready: true,
      selectItems: (data) => data.items,
      selectTotal: (data) => data.total,
    })
    return <PagedListFooter paged={paged} noun={noun} />
  }

  async function refusedAfterTheFirstPage(locale: string, noun: string) {
    const client = createTestQueryClient()
    const answers = [
      { structuredContent: { items: ["a", "b"], total: 3 } },
      { isError: true, content: [{ type: "text", text: REFUSED }] },
    ]
    const tools = { test_list_data: () => answers.shift() ?? answers[0] }
    render(
      <TestViewHost client={client} tools={tools} locale={locale}>
        <RefusedList noun={noun} />
      </TestViewHost>,
    )
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("2"))
    await act(() => client.invalidateQueries({ queryKey: ["test:refused"] }))
    const alert = await screen.findByRole("alert")
    await client.cancelQueries()
    return alert
  }

  it.each([
    [
      "en",
      "items",
      "You're seeing the previous result. Engine prod cannot be used: its profile is refused. Whoever runs this server finds the reason in its log at startup and can fix the profile. Until then, pick another engine.",
    ],
    [
      "de",
      "Einträge",
      "Du siehst das vorherige Ergebnis. Die Engine prod ist nicht nutzbar: ihr Profil ist abgelehnt. Die Person, die den Server betreibt, findet den Grund im Log beim Start und kann das Profil korrigieren. Wähl bis dahin eine andere Engine.",
    ],
  ])(
    "says the reason in %s, offers no retry and keeps the raw text under Details",
    async (locale, noun, line) => {
      const alert = await refusedAfterTheFirstPage(locale, noun)
      expect(alert.textContent).toContain(line)
      expect(alert.querySelector("details pre")?.textContent).toBe(REFUSED)
      expect(alert.querySelector("button")).toBeNull()
    },
  )
})
