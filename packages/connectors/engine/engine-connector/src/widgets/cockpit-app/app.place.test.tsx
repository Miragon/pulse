// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitAppData } from "../../view-models.js"
import { ENGINE_COCKPIT_OVERVIEW_DATA, ENGINE_LIST_ENGINES } from "../../tool-names.js"
import {
  activeEngine,
  boot,
  BOARDS_ONLY_TITLE,
  ENGINES,
  type EngineList,
  fakeAddress,
  FULLSCREEN,
  headSection,
  historyOf,
  jobScopes,
  JOBS_DATA,
  ON_BOARDS,
  overviewOf,
  type PageHost,
  PROCESS,
  REFUSED,
  REFUSED_REASON,
  REFUSED_TITLE,
  renderCockpitOn,
  rowLabels,
  selectEngine,
  trailRow,
} from "./app.test-support.js"

/**
 * The cockpit's place on a page as the reader moves inside it: an engine switch keeps what the new
 * engine has and adds its entry before a fallback names it anew (N7), and the jobs' scope is part
 * of the place, so the address, the entry's memo and Back keep the scope on screen (X6).
 */

let queryClient = createTestQueryClient()
afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

const RENDER = { timeout: 15_000 }

function renderPage(
  bootstrap?: CockpitAppData,
  list?: EngineList,
  page: PageHost = { startPage: "/app" },
) {
  return renderCockpitOn(queryClient, bootstrap, list, FULLSCREEN, page)
}

describe("an engine switch keeps the process where the engine deploys it (N7)", RENDER, () => {
  it("keeps it, its trail and name, on an engine that deploys it", async () => {
    const detail = { ...PROCESS, label: "Invoice" }
    renderPage(boot("prod-a", ENGINES, detail), {
      engines: ENGINES,
      deployed: { "prod-b": ["invoice"] },
    })
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    fireEvent.change(screen.getByLabelText("Selected engine"), { target: { value: "prod-b" } })
    await waitFor(() => expect(activeEngine()).toBe("prod-b"))
    await waitFor(() => expect(rowLabels()).toEqual(["All engines", "Overview", "Invoice"]))
    expect(screen.queryByText(/isn't deployed/)).toBeNull()
  })

  it("falls back to its section on one that does not, and says so", async () => {
    renderPage(boot("prod-a", ENGINES, { ...PROCESS, label: "Invoice" }), {
      engines: ENGINES,
      deployed: { "prod-b": ["billing"] },
    })
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    fireEvent.change(screen.getByLabelText("Selected engine"), { target: { value: "prod-b" } })
    expect(await screen.findByText("Invoice isn't deployed on prod-b.")).toBeTruthy()
    expect(headSection("Overview").getAttribute("aria-current")).toBe("page")
    expect(trailRow()).toBeNull()
  })

  it("adds the switch's entry before the fallback names it anew, the overview read before", async () => {
    // The landing, the cross-engine view or an earlier visit read prod-b's overview already.
    const deployed = { "prod-b": ["billing"] }
    queryClient.setQueryData(
      ["engine:cockpit-overview", "prod-b", { engine: "prod-b" }],
      overviewOf({ engine: "prod-b" }, deployed),
    )
    const address = fakeAddress()
    renderPage(
      boot("prod-a", ENGINES, { ...PROCESS, label: "Invoice" }),
      { engines: ENGINES, deployed },
      { startPage: "/app", location: address.location },
    )
    await waitFor(() => expect(address.reports.length).toBeGreaterThan(0))
    selectEngine("prod-b")
    expect(await screen.findByText("Invoice isn't deployed on prod-b.")).toBeTruthy()
    await waitFor(() =>
      expect(address.reports.at(-1)).toMatchObject({
        place: { args: { view: "overview", engine: "prod-b" } },
        entry: "replace",
      }),
    )
    // Back from prod-b's overview leads to the process the reader switched from.
    expect(historyOf(address.reports)).toEqual([
      { view: "process-detail", engine: "prod-a", processDefinitionKey: "invoice" },
      { view: "overview", engine: "prod-b" },
    ])
  })

  it.each([
    ["shown on boards only", ON_BOARDS.id, BOARDS_ONLY_TITLE],
    ["whose profile is refused", REFUSED.id, REFUSED_TITLE],
  ])(
    "asks an engine %s nothing, and checks the next engine that every route reads",
    async (_, id, title) => {
      const listed = [...ENGINES, ON_BOARDS]
      const { reads } = renderPage(
        boot("prod-a", [...listed, REFUSED], { ...PROCESS, label: "Invoice" }),
        {
          engines: listed,
          refused: [{ id: REFUSED.id, environment: "default", reason: REFUSED_REASON }],
          deployed: { "prod-b": ["invoice"] },
        },
      )
      const overviewsOf = (engine: string) =>
        reads(ENGINE_COCKPIT_OVERVIEW_DATA).filter((args) => args.engine === engine)
      await waitFor(() => expect(activeEngine()).toBe("prod-a"))
      selectEngine(id)
      // Its one state, which reads nothing: no feed of a route it has no section of.
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy()
      await waitFor(() => expect(reads(ENGINE_LIST_ENGINES).length).toBeGreaterThan(0))
      expect(overviewsOf(id)).toEqual([])
      // The process the trail kept waits for an engine that is asked: prod-b deploys it.
      selectEngine("prod-b")
      await waitFor(() => expect(overviewsOf("prod-b")).toHaveLength(1))
      await waitFor(() => expect(rowLabels()).toEqual(["All engines", "Overview", "Invoice"]))
    },
  )
})

describe("the jobs' scope is part of the cockpit's place (D3, X6)", RENDER, () => {
  it("names the scope chosen in the address anew, keeps the segment's focus, and Back keeps it", async () => {
    const address = fakeAddress()
    const withoutRetries = { ...JOBS_DATA, filters: { failedOnly: true } }
    renderPage(
      boot("prod-a", ENGINES, { section: "jobs", failedOnly: true }, withoutRetries),
      undefined,
      {
        startPage: "/app",
        location: address.location,
      },
    )
    await waitFor(() =>
      expect(address.reports[0]?.place.args).toEqual({
        view: "jobs",
        engine: "prod-a",
        failedOnly: true,
      }),
    )
    const all = within(jobScopes()).getByRole("radio", { name: /^All/ })
    all.focus()
    fireEvent.click(all)
    await waitFor(() =>
      expect(address.reports.at(-1)).toMatchObject({
        place: { args: { view: "jobs", engine: "prod-a" } },
        entry: "replace",
      }),
    )
    expect(address.reports.at(-1)?.place.args).not.toHaveProperty("failedOnly")
    // A choice inside the view, no navigation: the segment keeps focus, no heading takes it.
    await waitFor(() => expect(within(jobScopes()).getByRole("radio", { name: /^All/ })).toBe(all))
    expect(document.activeElement).toBe(all)
    expect(historyOf(address.reports)).toEqual([{ view: "jobs", engine: "prod-a" }])
    const chosen = address.reports.at(-1)!.place
    fireEvent.click(headSection("Incidents"))
    await waitFor(() => expect(address.reports.at(-1)?.entry).toBe("push"))
    expect(address.back(chosen)).toBe(true)
    await waitFor(() => expect(headSection("Jobs").getAttribute("aria-current")).toBe("page"))
    expect(
      within(jobScopes()).getByRole("radio", { name: /^All/ }).getAttribute("aria-checked"),
    ).toBe("true")
  })
})
