// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useState, type ReactNode } from "react"
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react"
import {
  AppQueryProvider,
  LocaleProvider,
  PagedListFooter,
  queryClient,
} from "@miragon/mcp-toolkit-ui"
import { PagedRows } from "./paged-rows.js"
import { Host, ROWS, Table, layout, shownRows } from "./inline-fit.test-support.js"
import { usePagedViewData } from "./use-paged-view-data.js"

/** #396 with an injected layout; the host simulation measures the real thing. */

afterEach(() => {
  cleanup()
  queryClient.clear()
})

describe("a table inline", () => {
  it("shows the rows that fit, says how many there are, and opens fullscreen", () => {
    const expand = vi.fn()
    // 300 px chrome, 60 px rows, a 40 px "more" line: 4 rows are 580 px.
    render(
      <Host expand={expand} measure={layout({ chrome: 300, row: 60 })}>
        <Table />
      </Host>,
    )
    expect(shownRows()).toEqual(ROWS.slice(0, 4))
    expect(screen.getByText("4 of 12 shown")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Show all" }))
    expect(expand).toHaveBeenCalledTimes(1)
  })

  it("fits more rows into a larger budget", () => {
    render(
      <Host budget={800} measure={layout({ chrome: 300, row: 60 })}>
        <Table />
      </Host>,
    )
    expect(shownRows()).toHaveLength(7)
  })

  it("leaves a table that fits as it is", () => {
    render(
      <Host measure={layout({ chrome: 300, row: 60 })}>
        <Table rows={ROWS.slice(0, 3)} />
      </Host>,
    )
    expect(shownRows()).toEqual(ROWS.slice(0, 3))
    expect(screen.queryByText(/shown$/)).toBeNull()
  })

  it("without fullscreen, shows the next rows in place and keeps them", () => {
    render(
      <Host measure={layout({ chrome: 300, row: 60 })}>
        <Table />
      </Host>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Show more" }))
    // The view is taller than the budget now; the rows the user asked for stay.
    expect(shownRows()).toEqual(ROWS.slice(0, 8))
    fireEvent.click(screen.getByRole("button", { name: "Show more" }))
    expect(shownRows()).toEqual(ROWS)
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull()
  })

  it("goes down to 1 row where that fits, and keeps 3 where nothing would", () => {
    // 470 px chrome, 87 px rows (the job panel): 1 row is 597 px.
    render(
      <Host measure={layout({ chrome: 470, row: 87 })}>
        <Table />
      </Host>,
    )
    expect(shownRows()).toHaveLength(1)
    cleanup()
    // 1000 px around the rows: nothing fits, 3 rows and the view scrolls inside.
    const { container } = render(
      <Host measure={layout({ chrome: 1000, row: 66 })}>
        <Table />
      </Host>,
    )
    expect(shownRows()).toHaveLength(3)
    expect(container.querySelector("[data-inline-fit]")?.getAttribute("data-inline-fit")).toBe(
      "overflow",
    )
  })

  it("starts over when the budget changes", () => {
    const measure = layout({ chrome: 300, row: 60 })
    const { rerender } = render(
      <Host measure={measure}>
        <Table />
      </Host>,
    )
    expect(shownRows()).toHaveLength(4)
    rerender(
      <Host budget={800} measure={measure}>
        <Table />
      </Host>,
    )
    expect(shownRows()).toHaveLength(7)
    rerender(
      <Host budget={400} measure={measure}>
        <Table />
      </Host>,
    )
    expect(shownRows()).toHaveLength(1)
  })

  it("shows every row in fullscreen and outside a host", () => {
    render(
      <Host active={false} measure={layout({ chrome: 300, row: 60 })}>
        <Table />
      </Host>,
    )
    expect(shownRows()).toEqual(ROWS)
    cleanup()
    render(
      <LocaleProvider locale="en">
        <Table />
      </LocaleProvider>,
    )
    expect(shownRows()).toEqual(ROWS)
  })
})

describe("a paged list inline", () => {
  interface Page {
    items: string[]
    total: number
  }
  const callTool = vi.fn()
  const toolkitDefaults = queryClient.getDefaultOptions()
  beforeEach(() => {
    callTool.mockReset()
    queryClient.setDefaultOptions({
      ...toolkitDefaults,
      queries: { ...toolkitDefaults.queries, retry: false },
    })
  })
  afterEach(() => queryClient.setDefaultOptions(toolkitDefaults))

  const seed: Page = { items: ROWS.slice(0, 10), total: 40 }

  function List({ search = "" }: { search?: string }) {
    const paged = usePagedViewData<string, Page>({
      initialData: seed,
      key: ["test:inline"],
      tool: "test_list_data",
      args: search ? { search } : {},
      pageSize: 10,
      ready: true,
      selectItems: (data) => data.items,
      selectTotal: (data) => data.total,
    })
    return (
      <>
        <PagedRows paged={paged}>
          <Table rows={paged.items} />
        </PagedRows>
        <PagedListFooter paged={paged} noun="things" labels={paged.footerLabels} />
      </>
    )
  }

  function renderList(expand: (() => void) | null) {
    return render(
      <AppQueryProvider callTool={callTool}>
        <Host expand={expand} measure={layout({ chrome: 300, row: 60 })}>
          <List />
        </Host>
      </AppQueryProvider>,
    )
  }

  it("fits its rows as ONE list, says how many it shows of all, and opens fullscreen", () => {
    const expand = vi.fn()
    renderList(expand)
    expect(shownRows()).toEqual(ROWS.slice(0, 4))
    // The table inside does not cap the rows a second time.
    expect(screen.queryByText(/shown$/)).toBeNull()
    expect(screen.getByText("Showing 4 of 40 things")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Show all" }))
    expect(expand).toHaveBeenCalledTimes(1)
    expect(callTool).not.toHaveBeenCalledWith("test_list_data", expect.anything())
  })

  it("without fullscreen, reveals the next rows in place, then fetches the next page", async () => {
    callTool.mockResolvedValue({
      structuredContent: { items: ROWS.slice(10, 12), total: 40 },
    })
    renderList(null)
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    expect(shownRows()).toEqual(ROWS.slice(0, 8))
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    expect(shownRows()).toEqual(ROWS.slice(0, 10))
    // Every loaded row shows: the next click fetches, and shows what it fetched.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Load more" })))
    expect(callTool).toHaveBeenCalledWith("test_list_data", { firstResult: 10, maxResults: 10 })
    expect(shownRows()).toEqual(ROWS)
  })

  it("a new search starts at the fitted head again", () => {
    function Searchable() {
      const [search, setSearch] = useState("")
      return (
        <>
          <button type="button" onClick={() => setSearch("x")}>
            search
          </button>
          <List search={search} />
        </>
      )
    }
    callTool.mockReturnValue(new Promise(() => undefined))
    render(
      <AppQueryProvider callTool={callTool}>
        <Host measure={layout({ chrome: 300, row: 60 })}>
          <Searchable />
        </Host>
      </AppQueryProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    expect(shownRows()).toHaveLength(8)
    fireEvent.click(screen.getByRole("button", { name: "search" }))
    expect(shownRows().length).toBeLessThanOrEqual(4)
  })

  it("shows every row outside a host", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppQueryProvider callTool={callTool}>{children}</AppQueryProvider>
    )
    const { result } = renderHook(
      () =>
        usePagedViewData<string, Page>({
          initialData: seed,
          key: ["test:outside"],
          tool: "test_list_data",
          args: {},
          pageSize: 10,
          ready: true,
          selectItems: (data) => data.items,
          selectTotal: (data) => data.total,
        }),
      { wrapper },
    )
    expect(result.current.items).toEqual(seed.items)
    expect(result.current.footerLabels).toBeUndefined()
  })
})
