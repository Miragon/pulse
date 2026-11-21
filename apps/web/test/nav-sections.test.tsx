// @vitest-environment happy-dom
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { TestViewHost, type ViewComponent } from "@miragon/pulse-widget-shell/widgets"
import { engineViews } from "@miragon/pulse-engine-connector/widgets"
import {
  FLEET_DIALECTS,
  inFleet,
  NAV_SECTIONS,
  placeOfSection,
  SECTION_VIEWS,
  sectionAt,
  sectionsOf,
  type NavDialect,
  type NavSection,
} from "../src/frame/nav-sections.js"
import { catalogs } from "../src/messages/index.js"
import { COCKPIT_VIEW } from "../src/router/routes.js"
import { cockpitProperties, type EngineEntry, registeredTools } from "./cockpit-tool.js"

/**
 * The sections the page's navigation opens under an engine, per dialect (src/frame/nav-sections.ts),
 * held to the engine module: the cockpit's sections the page embeds to the views its cockpit tool
 * offers a server of that dialect's engines alone (`view`'s enum follows ROUTE_DIALECTS), and the
 * page's own screens (an engine's processes, a process, an instance) to the screen feeds it
 * registers for them, both ways, so the navigation offers no section the server does not serve and
 * every dialect whose screens the server serves (Camunda 8's too) opens them; and to the sections
 * the cockpit's head shows an engine of that dialect, as the cockpit renders them in a chat, so no
 * section of the head, which a page with chrome of its own hides, goes missing from the navigation,
 * in the head's order and by the head's words, the overview's place the page's processes.
 */

afterEach(cleanup)

/** One engine of each dialect, as a profile names it. */
const ENGINE_OF: Readonly<Record<NavDialect, readonly EngineEntry[]>> = {
  c7: [{ id: "prod", baseUrl: "http://prod.example/engine-rest" }],
  c8: [{ id: "orders", baseUrl: "https://orders.example/v2", flavor: "camunda8" }],
}

/** The cockpit head's word for its overview, the place the page shows as an engine's processes. */
const OVERVIEW_WORD = { en: "Overview", de: "Übersicht" } as const

/** The page's own screens' feeds, which its processes section reads (the engine, process, instance). */
const SCREEN_FEEDS = [
  "engine_screen_processes_data",
  "engine_screen_process_data",
  "engine_screen_instances_data",
  "engine_screen_instance_data",
] as const

/** Whether the page shows an engine of `dialect` on its own screens (its processes section). */
const hasScreens = (dialect: string | undefined): boolean =>
  sectionsOf(dialect).includes("processes")

/** The sections the page embeds from the cockpit: all but its own processes. */
const embedded = (dialect: NavDialect): readonly NavSection[] =>
  NAV_SECTIONS[dialect].filter((section) => section !== "processes")

/** The views the cockpit tool offers a server of `dialect`'s engines alone. */
function servedViews(dialect: NavDialect): readonly unknown[] {
  return cockpitProperties(ENGINE_OF[dialect]).view?.enum ?? []
}

/** The cockpit, the engine module's one view, over its start data (the view's map knows no type). */
const Cockpit = engineViews[COCKPIT_VIEW] as ViewComponent<unknown>

/**
 * The words of the sections the cockpit's head shows an engine of `dialect` in `locale`, as a chat
 * renders it (no chrome), opened on the engine's overview; once its head shows.
 */
async function headSections(dialect: NavDialect, locale: "en" | "de"): Promise<string[]> {
  const engine = { id: ENGINE_OF[dialect][0].id, environment: "default", dialect }
  const data = {
    engineId: engine.id,
    engines: [engine],
    start: { view: { section: "overview" }, data: null },
  }
  const list = { engines: [engine], defaultEngineId: engine.id }
  // The route's own feeds have no fake: they fail, which leaves the head as it is.
  const { container } = render(
    <TestViewHost
      tools={{ engine_list_engines: list }}
      host={{ displayMode: "fullscreen" }}
      locale={locale}
    >
      <Cockpit data={data} />
    </TestViewHost>,
  )
  const head = await waitFor(() => {
    const found = container.querySelector("[data-slot=cockpit-head]")
    if (!found) throw new Error("the cockpit shows no head yet")
    return found
  })
  const tabs = head.querySelectorAll("[data-slot=nav-tab]")
  return Array.from(tabs, (tab) => tab.textContent ?? "")
}

describe("the navigation's sections per dialect", () => {
  it("names every dialect the engine list names", () => {
    expect(Object.keys(NAV_SECTIONS).sort()).toEqual(Object.keys(ENGINE_OF).sort())
  })

  it.each(Object.keys(NAV_SECTIONS) as NavDialect[])(
    "offers %s no section the server does not serve it, and its screens wherever it serves them",
    (dialect) => {
      const served = servedViews(dialect)
      // The comparison is not vacuous: every server offers its app-level views.
      expect(served).toEqual(expect.arrayContaining(["landing", "board"]))
      const views = embedded(dialect).map((section) => SECTION_VIEWS[section])
      expect(views.filter((view) => !served.includes(view))).toEqual([])
      // The page's own screens read their feeds: offered exactly where the server registers them.
      const feeds = registeredTools(ENGINE_OF[dialect])
      expect(SCREEN_FEEDS.map((feed) => feeds.includes(feed))).toEqual(
        SCREEN_FEEDS.map(() => hasScreens(dialect)),
      )
      // An incident the page knows by its id alone is found through the cockpit's incident view,
      // which serves the dialects of its incidents section (src/screens/screen-shown.ts).
      expect(NAV_SECTIONS[dialect].includes("incidents")).toBe(served.includes("incident-detail"))
    },
  )

  it.each(
    (Object.keys(NAV_SECTIONS) as NavDialect[]).flatMap((dialect) =>
      (["en", "de"] as const).map((locale) => [dialect, locale] as const),
    ),
  )(
    "offers %s every section the cockpit's head shows it, in its order, in %s",
    async (dialect, locale) => {
      const head = await headSections(dialect, locale)
      // The page's processes stand in the place of the cockpit's overview, which the page claims,
      // where the server's cockpit offers the dialect an overview (Camunda 7): its head shows it
      // first. Where it offers none (Camunda 8, which the chat shows on boards only) the head shows
      // no section, and the page's processes come from its screens alone.
      const overview = servedViews(dialect).includes("overview")
      const words = embedded(dialect).map((section) => catalogs[locale][`nav.section.${section}`])
      expect(overview ? [OVERVIEW_WORD[locale], ...words] : words).toEqual(head)
      expect(NAV_SECTIONS[dialect][0]).toBe("processes")
    },
  )

  it("opens Camunda 7's three and Camunda 8's processes, whose incidents and jobs no route reads", () => {
    expect(sectionsOf("c7")).toEqual(["processes", "incidents", "jobs"])
    expect(sectionsOf("c8")).toEqual(["processes"])
    expect(hasScreens("c7")).toBe(true)
    expect(hasScreens("c8")).toBe(true)
    // The cockpit's routes the page embeds do not serve a server of Camunda 8 engines alone.
    expect(servedViews("c8")).not.toEqual(expect.arrayContaining(["incidents"]))
    expect(servedViews("c8")).not.toEqual(expect.arrayContaining(["jobs"]))
    expect(servedViews("c8")).not.toEqual(expect.arrayContaining(["overview"]))
    expect(hasScreens(undefined)).toBe(false)
    expect(sectionsOf(undefined)).toEqual([])
    expect(sectionsOf("hasOwnProperty")).toEqual([])
  })

  it("counts Camunda 7's engines into the view across engines, as the cockpit reads them", () => {
    expect(FLEET_DIALECTS).toEqual(["c7"])
    expect(inFleet("c7")).toBe(true)
    expect(inFleet(undefined)).toBe(true)
    expect(inFleet("c8")).toBe(false)
    // The cockpit's fleet reads each engine's overview: the dialects it serves.
    for (const dialect of Object.keys(NAV_SECTIONS) as NavDialect[]) {
      expect(inFleet(dialect)).toBe(servedViews(dialect).includes("overview"))
    }
  })
})

describe("the section a place is the page of", () => {
  it.each([
    [{ view: "overview", engine: "prod" }, "processes"],
    [{ view: "incidents", engine: "prod" }, "incidents"],
    [{ view: "jobs", engine: "prod" }, "jobs"],
    [{ view: "jobs", engine: "prod", failedOnly: true }, "jobs"],
    [{ view: "jobs", engine: "prod", processDefinitionKey: "invoice" }, undefined],
    [{ view: "cluster-detail", engine: "prod", activityId: "a" }, undefined],
    [{ view: "process-detail", engine: "prod", processDefinitionKey: "invoice" }, undefined],
    [{ view: "landing" }, undefined],
  ])("%o is %s", (place, section) => {
    expect(sectionAt(place)).toBe(section)
  })
})

describe("the place a section opens", () => {
  it("opens the page's processes at the engine's own place, the others at their own", () => {
    expect(placeOfSection("processes", "prod")).toEqual({ view: "overview", engine: "prod" })
    expect(placeOfSection("incidents", "prod")).toEqual({ view: "incidents", engine: "prod" })
    expect(placeOfSection("jobs", "prod")).toEqual({ view: "jobs", engine: "prod" })
  })
})
