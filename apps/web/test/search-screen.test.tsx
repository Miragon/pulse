// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TestViewHost, WebApiError, type HostAction } from "@miragon/pulse-widget-shell/widgets"
import type { FindScreenData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { SearchScreen } from "../src/screens/search/search-screen.js"
import { FIND_FEED, searchOf } from "../src/screens/search/search-reads.js"

/**
 * The web app's search across engines over the kit world's find screens (WORLD_SCREENS of
 * @miragon/pulse-screens/testing, what the server's feed finds on the recorded engines:
 * packages/connectors/engine/engine-connector/src/data/screens/find-data.numbers.test.ts): every
 * engine asked apart, the hits of the others beside a refused or failing one, the history's gap,
 * the one hit that takes the search's place, none, the bar, German, the Refresh.
 */

afterEach(cleanup)

const ENGINE_LIST = "engine_list_engines"

/** Three engines and a refused profile, as the frame's one read of the engine list names them. */
const LIST = {
  engines: [
    { id: "prod-a", dialect: "c7" },
    { id: "prod-b", dialect: "c7" },
    { id: "c8-dev", dialect: "c8" },
  ],
  refused: [{ id: "legacy", reason: "auth.tokenEnv names a variable that is not set." }],
}

/** A refusal of the server as the feed's result says it. */
const refusal = (text: string) => ({ isError: true, content: [{ type: "text", text }] })

/** What an engine finds: the world's find screen under its name, with `hits` of its own. */
const foundOn = (engine: string, more: Partial<FindScreenData> = {}): FindScreenData => ({
  ...WORLD_SCREENS.find,
  engine,
  ...more,
})

const NONE: Partial<FindScreenData> = { hits: [] }

type Answers = Readonly<Record<string, unknown>>

function renderSearch({
  text = "ORD-1003",
  answers = {
    "prod-a": foundOn("prod-a"),
    "prod-b": foundOn("prod-b", { hits: WORLD_SCREENS.findById.hits }),
    "c8-dev": foundOn("c8-dev", NONE),
  },
  list = LIST,
  locale = "en",
  seen = false,
}: {
  text?: string
  answers?: Answers
  list?: unknown
  locale?: string
  /** Whether the search's entry was marked seen before (a return to it). */
  seen?: boolean
} = {}) {
  const actions: HostAction[] = []
  const navigate = vi.fn<(url: string) => void>()
  const replace = vi.fn<(url: string) => void>()
  let marked = seen
  const markSeen = vi.fn(() => {
    marked = true
  })
  const entry = { seen: () => marked, markSeen }
  render(
    <TestViewHost
      tools={{
        [ENGINE_LIST]: list,
        [FIND_FEED]: ({ engine }: { engine: string }) => {
          const answer = answers[engine]
          return typeof answer === "function" ? (answer as () => unknown)() : answer
        },
      }}
      onHostAction={(action) => actions.push(action)}
      locale={locale}
      host={{ timeZone: "UTC" }}
      writes={false}
      followUp="none"
      startPage="/app"
    >
      <SearchScreen text={text} navigate={navigate} replace={replace} entry={entry} />
    </TestViewHost>,
  )
  const reads = () =>
    actions.flatMap((action) =>
      action.type === "callTool" && action.name === FIND_FEED ? [action.args] : [],
    )
  return { navigate, replace, reads, markSeen }
}

/** An engine's failure a retry may change, as the feed's result says it. */
const unreachable = (engine: string) =>
  refusal(`[unreachable] connection to engine ${engine} failed (engine ${engine})`)

/** A page's ended session, as the page's call meets it. */
const signedOut = () => {
  throw new WebApiError(401, { code: "signed_out", message: "No session." })
}

/** The sentence of a search that found nothing on every engine. */
const NONE_TEXT = /^No instance has the ID or the business key/

const rows = () =>
  Array.from(
    screen.getByRole("table", { name: "Found instances" }).querySelectorAll("tbody > tr"),
    (row) => Array.from(row.querySelectorAll("td"), (cell) => cell.textContent),
  )

describe("the search across engines", () => {
  it("asks every engine apart, none refused, and lists the hits of those that answered in their order", async () => {
    const { reads, replace } = renderSearch()

    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(reads()).toEqual([
      { engine: "prod-a", text: "ORD-1003" },
      { engine: "prod-b", text: "ORD-1003" },
      { engine: "c8-dev", text: "ORD-1003" },
    ])
    expect(rows().map((cells) => cells.slice(1, 5))).toEqual([
      ["ORD-1003", "Order fulfillment v1", "prod-a", "Completed"],
      ["—", "Print label v1", "prod-b", "RunningIncident"],
    ])
    expect(replace).not.toHaveBeenCalled()
  })

  it("heads the page with what it searched, the hits, the engines searched, that it is exact, the Refresh and when it was read", async () => {
    renderSearch()
    const heading = await screen.findByRole("heading", { level: 1, name: "ORD-1003" })
    const bar = heading.closest<HTMLElement>("[data-slot=view-bar]")!

    expect(
      await within(bar).findByText("2 instances found · 3 engines searched · exact search"),
    ).toBeTruthy()
    expect(within(bar).getByRole("button", { name: "Refresh" })).toBeTruthy()
    expect(bar.querySelector("[data-slot=freshness-stamp]")?.textContent).toMatch(/^As of /)
  })

  it("says a refused profile in the strip as the server refuses it, reading nothing of it, beside the hits of the others", async () => {
    const { reads } = renderSearch()

    const strip = await screen.findByText("legacy couldn't be searched")
    const box = strip.closest<HTMLElement>("[data-slot=status-strip]")!
    expect(box.textContent).toContain("Engine legacy cannot be used: its profile is refused")
    expect(rows()).toHaveLength(2)
    expect(reads().map(({ engine }) => engine)).not.toContain("legacy")
  })

  it("names a refused profile without a reason the list gives none, and asks nothing of a list without engines", async () => {
    const { reads } = renderSearch({ list: { refused: [{ id: "legacy" }] } })

    expect(await screen.findByText("legacy couldn't be searched")).toBeTruthy()
    expect(
      screen.getByRole("heading", { level: 2, name: "No engine could be searched" }),
    ).toBeTruthy()
    expect(screen.queryByText(NONE_TEXT)).toBeNull()
    cleanup()
    renderSearch({ list: {} })
    expect(reads()).toEqual([])
  })

  it("names an engine whose history misses running instances, which the search can't find", async () => {
    renderSearch({
      answers: {
        "prod-a": foundOn("prod-a", { ...NONE, historyGap: { running: 5, counted: 0 } }),
        "prod-b": foundOn("prod-b"),
        "c8-dev": foundOn("c8-dev", NONE),
      },
    })

    expect(
      await screen.findByText("Running instances are missing from the history of prod-a"),
    ).toBeTruthy()
  })

  it("takes the search's place with the one instance found, where the others answered or were refused", async () => {
    const { replace } = renderSearch({
      answers: {
        "prod-a": foundOn("prod-a"),
        "prod-b": foundOn("prod-b", NONE),
        "c8-dev": foundOn("c8-dev", NONE),
      },
    })

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1))
    expect(replace).toHaveBeenCalledWith("/app/engines/prod-a/instances/fake-ORD-1003")
  })

  it("decides once for its entry, marking it seen once every engine settled", async () => {
    const { replace, markSeen } = renderSearch()

    await waitFor(() => expect(markSeen).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(markSeen).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
  })

  it("keeps the search on an entry it decided on before, where Back or a reload returns to it", async () => {
    const { replace, markSeen } = renderSearch({
      seen: true,
      answers: {
        "prod-a": foundOn("prod-a"),
        "prod-b": foundOn("prod-b", NONE),
        "c8-dev": foundOn("c8-dev", NONE),
      },
    })

    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(
      await screen.findByText("1 instance found · 3 engines searched · exact search"),
    ).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
    expect(markSeen).not.toHaveBeenCalled()
  })

  it("keeps the search where a Refresh brings the one hit, after an engine that failed answers", async () => {
    let calls = 0
    const { replace, markSeen } = renderSearch({
      answers: {
        "prod-a": foundOn("prod-a"),
        "prod-b": () => (calls++ === 0 ? unreachable("prod-b") : foundOn("prod-b", NONE)),
        "c8-dev": foundOn("c8-dev", NONE),
      },
    })

    expect(await screen.findByText("prod-b couldn't be searched")).toBeTruthy()
    await waitFor(() => expect(markSeen).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(screen.queryByText("prod-b couldn't be searched")).toBeNull())
    expect(rows()).toHaveLength(1)
    expect(replace).not.toHaveBeenCalled()
  })

  it("keeps the search with its one hit where an engine's history misses running instances", async () => {
    const { replace, markSeen } = renderSearch({
      answers: {
        "prod-a": foundOn("prod-a"),
        "prod-b": foundOn("prod-b", { ...NONE, historyGap: { running: 5, counted: 0 } }),
        "c8-dev": foundOn("c8-dev", NONE),
      },
    })

    expect(
      await screen.findByText("Running instances are missing from the history of prod-b"),
    ).toBeTruthy()
    await waitFor(() => expect(markSeen).toHaveBeenCalledTimes(1))
    expect(rows()).toHaveLength(1)
    expect(replace).not.toHaveBeenCalled()
  })

  it("keeps the search with its one hit where an engine failed for a reason a retry may change", async () => {
    const { replace } = renderSearch({
      answers: {
        "prod-a": foundOn("prod-a"),
        "prod-b": refusal("[unreachable] connection to engine prod-b failed (engine prod-b)"),
        "c8-dev": foundOn("c8-dev", NONE),
      },
    })

    expect(await screen.findByText("prod-b couldn't be searched")).toBeTruthy()
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(replace).not.toHaveBeenCalled()
  })

  it("says what it searched and that the search is exact where no engine found an instance", async () => {
    renderSearch({
      text: "ORD-404",
      list: { engines: LIST.engines },
      answers: {
        "prod-a": foundOn("prod-a", NONE),
        "prod-b": foundOn("prod-b", NONE),
        "c8-dev": foundOn("c8-dev", NONE),
      },
    })

    expect(
      await screen.findByText(
        'No instance has the ID or the business key "ORD-404". Pulse finds the whole ID or the exact business key, never a part of one.',
      ),
    ).toBeTruthy()
    expect(screen.getByText("0 instances found · 3 engines searched · exact search")).toBeTruthy()
  })

  it("speaks only of the engines that could be searched where one found nothing and another failed", async () => {
    renderSearch({
      text: "ORD-404",
      answers: {
        "prod-a": foundOn("prod-a", NONE),
        "prod-b": unreachable("prod-b"),
        "c8-dev": foundOn("c8-dev", NONE),
      },
    })

    expect(
      await screen.findByText(
        'No engine that could be searched has an instance with the ID or the business key "ORD-404". Pulse finds the whole ID or the exact business key, never a part of one.',
      ),
    ).toBeTruthy()
    expect(screen.getByText("prod-b couldn't be searched")).toBeTruthy()
    expect(screen.queryByText(NONE_TEXT)).toBeNull()
  })

  it("opens a row's instance in a new entry of the page's history", async () => {
    const { navigate } = renderSearch()
    await waitFor(() => expect(rows()).toHaveLength(2))

    const row = screen.getByRole("row", { name: "Instance ORD-1003 on prod-a" })
    expect(row.dataset.href).toBe("/app/engines/prod-a/instances/fake-ORD-1003")
    fireEvent.click(within(row).getByText("Order fulfillment v1"))
    expect(navigate).toHaveBeenCalledWith("/app/engines/prod-a/instances/fake-ORD-1003")
  })

  it("reads every engine again on Refresh", async () => {
    const { reads } = renderSearch()
    await waitFor(() => expect(rows()).toHaveLength(2))
    const first = reads().length

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))

    await waitFor(() => expect(reads().length).toBe(first * 2))
  })

  it("speaks German on a German page", async () => {
    renderSearch({ locale: "de" })

    expect(await screen.findByText("legacy konnte nicht durchsucht werden")).toBeTruthy()
    expect(
      await screen.findByText("2 Instanzen gefunden · 3 Engines durchsucht · genaue Suche"),
    ).toBeTruthy()
    expect(screen.getByRole("table", { name: "Gefundene Instanzen" })).toBeTruthy()
  })
})

describe("the search's states", () => {
  it("shows how to search and reads nothing without a text", async () => {
    const { reads } = renderSearch({ text: "" })

    expect(await screen.findByRole("heading", { level: 1, name: "Find an instance" })).toBeTruthy()
    expect(
      screen.getByText(
        "Type an instance's ID or its exact business key into the search field of the navigation.",
      ),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull()
    expect(reads()).toEqual([])
  })

  it("says it searches while no engine answered yet", async () => {
    renderSearch({ answers: { "prod-a": new Promise(() => undefined) } })

    expect(await screen.findByText("Searching every engine for ORD-1003…")).toBeTruthy()
  })

  it("says it searches, never that nothing was found, while an engine that may hold the instance has not answered", async () => {
    const { replace, markSeen } = renderSearch({
      answers: {
        "prod-a": foundOn("prod-a", NONE),
        "prod-b": new Promise(() => undefined),
        "c8-dev": foundOn("c8-dev", NONE),
      },
    })

    expect(await screen.findByText("Searching every engine for ORD-1003…")).toBeTruthy()
    await waitFor(() => expect(screen.getByText("legacy couldn't be searched")).toBeTruthy())
    expect(screen.queryByText(/has an instance with the ID|No instance has the ID/)).toBeNull()
    expect(screen.queryByRole("table")).toBeNull()
    expect(markSeen).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it("shows the hits of the engines that answered while another still searches", async () => {
    renderSearch({
      answers: {
        "prod-a": foundOn("prod-a"),
        "prod-b": new Promise(() => undefined),
        "c8-dev": foundOn("c8-dev", NONE),
      },
    })

    await waitFor(() => expect(rows()).toHaveLength(1))
    const region = screen.getByRole("table", { name: "Found instances" }).closest("[aria-busy]")
    expect(region?.getAttribute("aria-busy")).toBe("true")
  })

  it("says no engine could be searched where every engine failed, never that no instance exists", async () => {
    renderSearch({
      answers: {
        "prod-a": unreachable("prod-a"),
        "prod-b": unreachable("prod-b"),
        "c8-dev": unreachable("c8-dev"),
      },
    })

    expect(
      await screen.findByRole("heading", { level: 2, name: "No engine could be searched" }),
    ).toBeTruthy()
    expect(
      screen.getByText("Above, each engine says why it couldn't be searched and what you can do."),
    ).toBeTruthy()
    for (const engine of ["prod-a", "prod-b", "c8-dev", "legacy"]) {
      expect(screen.getByText(`${engine} couldn't be searched`)).toBeTruthy()
    }
    expect(screen.queryByText(NONE_TEXT)).toBeNull()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("shows only a quiet line where the page's session ended on every engine, the frame saying why", async () => {
    renderSearch({
      answers: { "prod-a": signedOut, "prod-b": signedOut, "c8-dev": signedOut },
    })

    const quiet = await screen.findByText("No engine could be searched")
    expect(quiet.tagName).toBe("P")
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull()
    expect(screen.queryByText(NONE_TEXT)).toBeNull()
    expect(screen.queryByText("prod-a couldn't be searched")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("says a text longer than an ID or a business key can be, reading nothing", async () => {
    const { reads } = renderSearch({ text: "x".repeat(257) })

    expect(await screen.findByRole("heading", { level: 1, name: "Find an instance" })).toBeTruthy()
    expect(
      screen.getByText(
        "An instance's ID or business key has at most 256 characters. Shorten the text in the search field and search again.",
      ),
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull()
    expect(reads()).toEqual([])
    cleanup()
    renderSearch({ text: "x".repeat(257), locale: "de" })
    expect(
      await screen.findByText(
        "Die ID oder der Geschäftsschlüssel einer Instanz hat höchstens 256 Zeichen. Kürze den Text im Suchfeld und suche noch einmal.",
      ),
    ).toBeTruthy()
  })

  it("says why the engines couldn't be loaded and reads them again on Try again", async () => {
    let fail = true
    renderSearch({
      list: () =>
        fail ? refusal("[unreachable] connection to engine prod-a failed (engine prod-a)") : LIST,
    })

    const alert = await screen.findByRole("alert")
    fail = false
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(rows()).toHaveLength(2))
  })

  it("leaves a page's ended session to the frame's notice, no strip for it", async () => {
    renderSearch({
      answers: {
        "prod-a": foundOn("prod-a"),
        "prod-b": foundOn("prod-b"),
        "c8-dev": () => {
          throw new WebApiError(401, { code: "signed_out", message: "No session." })
        },
      },
    })

    await waitFor(() => expect(rows()).toHaveLength(2))
    expect(screen.queryByText("c8-dev couldn't be searched")).toBeNull()
  })

  it("says an engine the page's call failed on without Details where the failure names none", async () => {
    renderSearch({
      answers: {
        "prod-a": foundOn("prod-a"),
        "prod-b": foundOn("prod-b"),
        "c8-dev": () => {
          throw new Error("")
        },
      },
    })

    const strip = (await screen.findByText("c8-dev couldn't be searched")).closest<HTMLElement>(
      "[data-slot=status-strip]",
    )!
    expect(within(strip).queryByRole("button", { name: /Details/ })).toBeNull()
  })

  it("says a Camunda 8 cluster without secondary storage with its fix", async () => {
    renderSearch({
      answers: {
        "prod-a": foundOn("prod-a"),
        "prod-b": foundOn("prod-b"),
        "c8-dev": refusal(
          "[misconfigured] This cluster runs without secondary storage, so its search API answers nothing (engine c8-dev)",
        ),
      },
    })

    const strip = (await screen.findByText("c8-dev couldn't be searched")).closest<HTMLElement>(
      "[data-slot=status-strip]",
    )!
    expect(strip.textContent).toContain("The cluster of c8-dev has no secondary storage")
  })
})

describe("an engine's search", () => {
  it("is pending while its read has not started, and holds what its read holds once it has", () => {
    expect(searchOf("prod-a", undefined)).toEqual({
      engine: "prod-a",
      found: undefined,
      error: null,
      pending: true,
      fetching: false,
    })
    const found = foundOn("prod-a")
    expect(
      searchOf("prod-a", { data: found, error: null, isPending: false, isFetching: true }),
    ).toEqual({ engine: "prod-a", found, error: null, pending: false, fetching: true })
  })
})
