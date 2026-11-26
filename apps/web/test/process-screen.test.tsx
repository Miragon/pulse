// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TestViewHost, WebApiError, type HostAction } from "@miragon/pulse-widget-shell/widgets"
import type {
  InstanceListData,
  InstanceListFilterData,
  InstanceRowData,
  ProcessScreenData,
} from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { BPMN_XML_FEED } from "../src/screens/instance/instance-feed.js"
import {
  INSTANCES_FEED,
  isRefusedCondition,
  isUnknownProcess,
  PROCESS_SCREEN_FEED,
  VARIABLE_NAMES_FEED,
} from "../src/screens/process/process-feed.js"
import { ProcessScreen } from "../src/screens/process/process-screen.js"
import { READ_AGAIN_AFTER_MS } from "../src/screens/read-on-return.js"
import { WIDE } from "../src/screens/use-wide.js"
import { drawn, reset } from "./bpmn-viewer.test-support.js"
import { onEveryClock } from "./time-zones.test-support.js"

/**
 * The web app's process screen over the kit world's process screens and instance list
 * (WORLD_SCREENS of @miragon/pulse-screens/testing: pulse-order at its latest version with the
 * notice that version 1 still runs, pulse-dispatch with its call activity, every instance of
 * pulse-order's version 1; the numbers the editors' definition view shows of the same world and
 * the server's feeds build of the recorded engines, process-screen-data.numbers.test in the engine
 * connector): its bar and version picker, its strips (older versions, a version the engine lacks,
 * a history that misses instances, what it could not read), its diagram's counts and call buttons
 * over a stand-in of the viewer, its instance list with its filter bar, Load more and its states,
 * Escape, the variable names read when the dialog opens, its refusals, German, and no write.
 */

// bpmn-js's viewer, a stand-in whose drawing holds every element (bpmn-js draws in a browser).
vi.mock("bpmn-js/lib/NavigatedViewer", async () => ({
  default: (await import("./bpmn-viewer.test-support.js")).FakeViewer,
}))

let wide = true

beforeEach(() => {
  wide = true
  reset()
  window.matchMedia = ((query: string) => ({
    matches: query === WIDE ? wide : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})

afterEach(cleanup)

const WEB_APP = {
  url: "https://ops.example/cockpit/#/process-definition/pulse-order:2",
  vendor: "CIB seven",
}

/** The process feed's answer: a world's screen with the version in the engine's web app. */
const answer = (data: ProcessScreenData = WORLD_SCREENS.process, more: object = {}) => ({
  ...data,
  webApp: WEB_APP,
  ...more,
})

/** The list feed's answer: the world's instance list, with what a test changes. */
const listOf = (more: Partial<InstanceListData> = {}): InstanceListData => ({
  ...WORLD_SCREENS.instanceList,
  ...more,
})

/** A refusal of the server as a feed's result says it. */
const refusal = (text: string) => ({ isError: true, content: [{ type: "text", text }] })

const DIAGRAM = { processDefinitionId: "pulse-order:2", bpmnXml: "<definitions/>" }

const row = (id: string, more: Partial<InstanceRowData> = {}): InstanceRowData => ({
  id,
  state: "running",
  hasIncident: false,
  businessKey: id.toUpperCase(),
  startedAt: "2026-11-19T08:00:00.000Z",
  ...more,
})

/** The screen as the page holds it: its filter the page's, which each pick sets anew. */
function Filtered({
  first,
  onFilter,
  ...props
}: {
  readonly first: InstanceListFilterData
  readonly onFilter: (filter: InstanceListFilterData) => void
  readonly onVersion: (version: number, filter: InstanceListFilterData) => void
  readonly navigate: (url: string) => void
  readonly version?: number
  readonly ready: boolean
}) {
  const [filter, setFilter] = useState(first)
  return (
    <ProcessScreen
      engine="prod-a"
      process="pulse-order"
      filter={filter}
      onFilter={(next) => {
        onFilter(next)
        setFilter(next)
      }}
      {...props}
    />
  )
}

function renderScreen({
  feed = answer(),
  list = listOf(),
  diagram = DIAGRAM,
  tools = {},
  locale = "en",
  filter = { scope: "running" },
  version,
  ready = true,
}: {
  feed?: unknown
  list?: unknown
  diagram?: unknown
  tools?: Record<string, unknown>
  locale?: string
  filter?: InstanceListFilterData
  version?: number
  ready?: boolean
} = {}) {
  const actions: HostAction[] = []
  const navigate = vi.fn<(url: string) => void>()
  const onFilter = vi.fn<(filter: InstanceListFilterData) => void>()
  const onVersion = vi.fn<(version: number, filter: InstanceListFilterData) => void>()
  render(
    <TestViewHost
      tools={{
        [PROCESS_SCREEN_FEED]: feed,
        [INSTANCES_FEED]: list,
        [BPMN_XML_FEED]: diagram,
        [VARIABLE_NAMES_FEED]: { definitionId: "pulse-order:2", names: ["amount"], refused: [] },
        ...tools,
      }}
      onHostAction={(action) => actions.push(action)}
      locale={locale}
      host={{ timeZone: "UTC" }}
      writes={false}
      followUp="none"
      startPage="/app"
    >
      <Filtered
        first={filter}
        onFilter={onFilter}
        onVersion={onVersion}
        navigate={navigate}
        {...(version === undefined ? {} : { version })}
        ready={ready}
      />
    </TestViewHost>,
  )
  const calls = () =>
    actions.filter(
      (action): action is Extract<HostAction, { type: "callTool" }> => action.type === "callTool",
    )
  const reads = (name: string) => calls().filter((action) => action.name === name)
  /** The order of the screen's reads of its process and its list. */
  const order = () =>
    calls()
      .map(({ name }) => name)
      .filter((name) => name === PROCESS_SCREEN_FEED || name === INSTANCES_FEED)
  return { navigate, onFilter, onVersion, reads, order }
}

/** The page's heading, once the screen read its process (its version picker shows). */
async function heading(): Promise<HTMLElement> {
  await screen.findByRole("combobox", { name: "Version" })
  return screen.getByRole("heading", { level: 1 })
}

/** The instance table's rows by business key, once the list answered. */
async function rowKeys(): Promise<string[]> {
  const table = await screen.findByRole("table", { name: "Instances" })
  return Array.from(table.querySelectorAll("tbody > tr"), (tr) => tr.children[1]?.textContent ?? "")
}

describe("the process screen", () => {
  it("heads the page with the process, the engine, the version picker, the Refresh, the web app and when it was read", async () => {
    renderScreen()
    expect((await heading()).textContent).toBe("Order fulfillment")
    const bar = (await heading()).closest<HTMLElement>("[data-slot=view-bar]")!
    expect(within(bar).getByText("prod-a")).toBeTruthy()
    const picker = within(bar).getByRole<HTMLSelectElement>("combobox", { name: "Version" })
    expect([...picker.options].map((option) => option.text)).toEqual([
      "v2 · 1 running",
      "v1 · 2 running · 1 with incident",
    ])
    expect(picker.value).toBe("pulse-order:2")
    expect(within(bar).getByRole("button", { name: "Refresh" })).toBeTruthy()
    expect(
      within(bar)
        .getByRole("link", { name: /Open in CIB seven/ })
        .getAttribute("href"),
    ).toBe(WEB_APP.url)
    expect(bar.querySelector("[data-slot=freshness-stamp]")?.textContent).toMatch(/^As of Nov 19/)
  })

  it("asks for another version by its number, the variable conditions kept, as in the editors", async () => {
    const amount = { name: "amount", operator: "greaterThan", value: "5" } as const
    const { onVersion } = renderScreen({
      filter: { scope: "ended", elementId: "Activity_ReviewOrder", variables: [amount] },
    })
    const picker = within(
      (await heading()).closest<HTMLElement>("[data-slot=view-bar]")!,
    ).getByRole("combobox", { name: "Version" })
    fireEvent.change(picker, { target: { value: "pulse-order:1" } })
    expect(onVersion).toHaveBeenLastCalledWith(1, { scope: "running", variables: [amount] }, "pick")
    fireEvent.click(screen.getByRole("button", { name: "Show v1" }))
    expect(onVersion).toHaveBeenLastCalledWith(1, { scope: "running", variables: [amount] }, "show")
  })

  it("keeps the version picker among the bar's actions, its facts the engine alone", async () => {
    renderScreen()
    const bar = (await heading()).closest<HTMLElement>("[data-slot=view-bar]")!
    const facts = bar.querySelector<HTMLElement>("[data-slot=view-bar-facts]")
    expect(facts?.textContent).toBe("prod-a")
    expect(within(facts!).queryByRole("combobox")).toBeNull()
  })

  it("says that older versions still run, and leads to the newest of them", async () => {
    renderScreen({ filter: { scope: "all" } })
    await heading()
    expect(
      screen.getByText("2 instances still run on older versions, 1 of them with incident."),
    ).toBeTruthy()
  })

  it("says a version the address names that the engine lacks, and shows the latest", async () => {
    renderScreen({ version: 9 })
    await heading()
    expect(screen.getByText("Version 9 of this process isn't on the engine")).toBeTruthy()
    expect(screen.getByText("Pulse shows v2, the latest version.")).toBeTruthy()
  })

  it("says what it couldn't read beside the versions: the diagram's counts, the processes it calls, the diagram", async () => {
    renderScreen({
      feed: answer({
        ...WORLD_SCREENS.process,
        badges: [],
        unread: ["diagram", "statistics", "calledProcesses"],
      }),
    })
    await heading()
    expect(
      screen.getByText("The counts on the diagram couldn't be loaded. Refresh to try again."),
    ).toBeTruthy()
    expect(
      screen.getByText(
        "The processes this version calls couldn't be loaded. Refresh to try again.",
      ),
    ).toBeTruthy()
    expect(screen.getByText("The diagram couldn't be loaded. Refresh to try again.")).toBeTruthy()
    // No count shows where none was read: never a 0.
    expect(document.querySelector("[data-part=canvas-badge]")).toBeNull()
  })

  it("says the engine has no diagram for a version without one, and waits for one being read", async () => {
    renderScreen({ diagram: { processDefinitionId: "pulse-order:2", bpmnXml: null } })
    expect(await screen.findByText("The engine has no diagram for this version.")).toBeTruthy()
    cleanup()
    renderScreen({ diagram: () => new Promise(() => {}) })
    await heading()
    expect(screen.getByText("Loading the diagram…").getAttribute("role")).toBe("status")
  })

  it("draws the diagram's counts, which filter the list to their element and scope", async () => {
    const { onFilter } = renderScreen({ filter: { scope: "ended", businessKey: "ORD-1" } })
    const count = await screen.findByRole("button", {
      name: /^Activity_ReviewOrder: 1 instance running/,
    })
    fireEvent.click(count)
    expect(onFilter).toHaveBeenLastCalledWith({
      scope: "running",
      elementId: "Activity_ReviewOrder",
      businessKey: "ORD-1",
    })
  })

  it("links a call activity to the version it calls: a plain click in place, a modified one the browser's", async () => {
    const dispatch = {
      ...WORLD_SCREENS.callingProcess,
      calls: [
        ...WORLD_SCREENS.callingProcess.calls,
        { elementId: "Activity_Ship", kind: "missing", bpmnProcessId: "pulse-ship" },
      ],
    } as ProcessScreenData
    const { navigate } = renderScreen({ feed: answer(dispatch) })
    const call = await screen.findByRole("link", { name: "Open called process Print label" })
    expect(call.getAttribute("href")).toBe("/app/engines/prod-a/processes/pulse-label?version=1")
    fireEvent.click(call)
    expect(navigate).toHaveBeenLastCalledWith("/app/engines/prod-a/processes/pulse-label?version=1")
    expect(fireEvent.click(call, { metaKey: true })).toBe(true)
    const ship = screen.getByRole("button", { name: /pulse-ship isn't deployed/ })
    expect(ship.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(ship)
    expect(navigate).toHaveBeenCalledOnce()
  })

  it("splits the window between the diagram and the list from 64rem on, and stacks them under it", async () => {
    renderScreen()
    await heading()
    expect(screen.getByRole("separator", { name: "Resize diagram and instances" })).toBeTruthy()
    cleanup()
    wide = false
    renderScreen()
    await heading()
    expect(screen.queryByRole("separator")).toBeNull()
    const frame = document.querySelector<HTMLElement>("[data-slot=process-diagram-frame]")!
    expect(frame.className).toContain(
      "h-[clamp(240px,calc(100dvh_-_28rem_-_var(--process-strips,0px)),560px)]",
    )
  })

  it("stacked, leaves the strips under the bar their height, as measured, beside the list's first rows", async () => {
    wide = false
    const observed: HTMLElement[] = []
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly changed: () => void) {}
        observe(target: HTMLElement) {
          observed.push(target)
          this.changed()
        }
        disconnect() {}
      },
    )
    const height = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.slot === "process-strips" ? 41 : 0
      })
    try {
      renderScreen()
      await heading()
      const frame = () => document.querySelector<HTMLElement>("[data-slot=process-diagram-frame]")!
      await waitFor(() => {
        expect(frame().style.getPropertyValue("--process-strips")).toBe("41px")
      })
      // The strips' one observer (the diagram's canvas observes its own size besides).
      expect(observed.filter((target) => target.dataset.slot === "process-strips")).toHaveLength(1)
    } finally {
      height.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it("reads nothing before it may, and names the process meanwhile", async () => {
    const { reads } = renderScreen({ ready: false })
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("pulse-order")
    await act(async () => {})
    expect(reads(PROCESS_SCREEN_FEED)).toHaveLength(0)
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull()
  })

  it("refuses a process the engine has no version of once, with the way to the engine's processes", async () => {
    const { reads } = renderScreen({
      feed: refusal('[UNKNOWN_PROCESS] Process "pulse-order" has no version on engine "prod-a".'),
    })
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Process pulse-order isn't on engine prod-a",
      }),
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: "Processes of prod-a" }).getAttribute("href")).toBe(
      "/app/engines/prod-a",
    )
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(reads(PROCESS_SCREEN_FEED)).toHaveLength(1)
  })

  it("says a failed read in the kit's words, and reads again on Try again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let failing = true
      const { reads } = renderScreen({
        feed: () => (failing ? refusal("Something unexpected happened") : answer()),
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      const retry = await screen.findByRole("button", { name: "Try again" })
      expect(screen.getByText("Process pulse-order couldn't be loaded")).toBeTruthy()
      failing = false
      await act(async () => {
        fireEvent.click(retry)
        await vi.advanceTimersByTimeAsync(10)
      })
      expect(await heading()).toBeTruthy()
      expect(reads(PROCESS_SCREEN_FEED).length).toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it("says a failed refresh of the list over the rows on screen in a strip, the rows kept", async () => {
    let fails = false
    renderScreen({
      list: () => {
        if (fails) throw new WebApiError(502, { message: "bad gateway" })
        return listOf()
      },
    })
    expect(await rowKeys()).toEqual(["ORD-1001", "ORD-1002", "ORD-1003"])
    fails = true
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(await screen.findByText("Couldn't refresh this view")).toBeTruthy()
    expect(await rowKeys()).toEqual(["ORD-1001", "ORD-1002", "ORD-1003"])
    fails = false
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => {
      expect(screen.queryByText("Couldn't refresh this view")).toBeNull()
    })
  })

  it("reads the versions first and the list over them again on Refresh, and a failed diagram again", async () => {
    let diagramFails = true
    const { reads, order } = renderScreen({
      diagram: () => {
        if (diagramFails) throw new WebApiError(502, { message: "no diagram" })
        return DIAGRAM
      },
    })
    await heading()
    await waitFor(() => {
      expect(reads(INSTANCES_FEED)).toHaveLength(1)
    })
    await screen.findByText("The diagram couldn't be loaded. Refresh to try again.", undefined, {
      timeout: 20_000,
    })
    diagramFails = false
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => {
      expect(reads(INSTANCES_FEED)).toHaveLength(2)
    })
    expect(reads(PROCESS_SCREEN_FEED)).toHaveLength(2)
    expect(order()).toEqual([
      PROCESS_SCREEN_FEED,
      INSTANCES_FEED,
      PROCESS_SCREEN_FEED,
      INSTANCES_FEED,
    ])
    await waitFor(() => {
      expect(drawn.overlays.length).toBeGreaterThan(0)
    })
  }, 30_000)

  it("says a history that misses running instances over the version's whole list", async () => {
    renderScreen({
      list: listOf({ rows: [], counts: { running: 0, withIncident: 1, ended: 0, all: 0 } }),
    })
    await heading()
    expect(await screen.findByText("The history misses running instances")).toBeTruthy()
  })

  it("says no such thing over counts read before the versions, a floor's answer of an earlier read", async () => {
    renderScreen({
      list: listOf({
        rows: [],
        counts: { running: 0, withIncident: 1, ended: 0, all: 0 },
        asOf: "2026-11-19T08:59:30.000Z",
      }),
    })
    await heading()
    await screen.findByRole("radio", { name: /^All/ })
    expect(screen.queryByText("The history misses running instances")).toBeNull()
  })

  it("writes nothing, selects nothing and hands nothing to a chat", async () => {
    renderScreen()
    await rowKeys()
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(
      screen.queryByRole("button", { name: /retry|resolve|suspend|cancel|migrat|ask|chat/i }),
    ).toBeNull()
  })

  it("words its own parts in German", async () => {
    renderScreen({ locale: "de", version: 9 })
    await screen.findByRole("table", { name: "Instanzen" })
    expect(
      screen.getByText("Die Version 9 dieses Prozesses gibt es auf der Engine nicht"),
    ).toBeTruthy()
    expect(screen.getByRole("button", { name: "Aktualisieren" })).toBeTruthy()
    expect(screen.getByRole("radio", { name: /^Laufend/ })).toBeTruthy()
  })
})

describe("the process screen's instance list", () => {
  it("lists the version's instances under its scopes and their counts, a row linked to its instance", async () => {
    const { reads } = renderScreen()
    expect(await rowKeys()).toEqual(["ORD-1001", "ORD-1002", "ORD-1003"])
    expect(screen.getByRole("radio", { name: /^Running/ }).textContent).toContain("2")
    expect(screen.getByRole("radio", { name: /^All/ }).textContent).toContain("3")
    const first = screen.getByRole("row", { name: "Instance ORD-1001" })
    expect(first.querySelector("a")?.getAttribute("href") ?? first.getAttribute("data-href")).toBe(
      "/app/engines/prod-a/instances/fake-ORD-1001",
    )
    expect(reads(INSTANCES_FEED).at(-1)?.args).toEqual({
      engine: "prod-a",
      definitionId: "pulse-order:2",
      scope: "running",
    })
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
  })

  it("reads a count the engine stopped at as a lower bound", async () => {
    renderScreen({
      list: listOf({
        counts: {
          running: 10_000,
          withIncident: 3,
          ended: 0,
          all: 10_000,
          atLeast: ["running", "all"],
        },
      }),
    })
    await rowKeys()
    expect(screen.getByRole("radio", { name: /^Running/ }).textContent).toContain("10k+")
  })

  onEveryClock(() => {
    it("asks for the list by its filter: an element, the exact key, a condition, a date as its instant", async () => {
      const at = "2026-03-15T10:00"
      const { reads } = renderScreen({
        filter: {
          scope: "all",
          elementId: "Task_A",
          businessKey: "ORD-1",
          variables: [
            { name: "dueAt", operator: "lessThan", value: at, as: "date" },
            { name: "sentAt", operator: "equals", value: "2026-03-15T10:00Z", as: "date" },
            { name: "route", operator: "equals", value: "review" },
          ],
        },
      })
      await rowKeys()
      expect(reads(INSTANCES_FEED).at(-1)?.args).toEqual({
        engine: "prod-a",
        definitionId: "pulse-order:2",
        scope: "all",
        element: "Task_A",
        businessKey: "ORD-1",
        variables: [
          { name: "dueAt", operator: "lessThan", value: new Date(at).toISOString(), as: "date" },
          { name: "sentAt", operator: "equals", value: "2026-03-15T10:00Z", as: "date" },
          { name: "route", operator: "equals", value: "review" },
        ],
      })
    })
  })

  it("keeps a date it cannot read as it is, for the server to refuse", async () => {
    const { reads } = renderScreen({
      filter: {
        scope: "running",
        variables: [{ name: "dueAt", operator: "lessThan", value: "2026-13-45T10:00", as: "date" }],
      },
    })
    await rowKeys()
    expect(
      (reads(INSTANCES_FEED).at(-1)?.args as { variables: { value: string }[] }).variables[0]
        ?.value,
    ).toBe("2026-13-45T10:00")
  })

  it("loads the next page by its cursor and puts its rows after those shown, a repeated row once", async () => {
    const pages: Record<string, InstanceListData> = {
      first: listOf({ rows: [row("a"), row("b")], next: "c1" }),
      c1: listOf({ rows: [row("b"), row("c")], next: "c2", counts: null }),
      c2: listOf({ rows: [row("d")], next: null, counts: null }),
    }
    const { reads } = renderScreen({
      list: (args: { after?: string }) => pages[args.after ?? "first"],
    })
    expect(await rowKeys()).toEqual(["A", "B"])
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    await waitFor(async () => {
      expect(await rowKeys()).toEqual(["A", "B", "C"])
    })
    expect(reads(INSTANCES_FEED).at(-1)?.args).toMatchObject({ after: "c1" })
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    await waitFor(async () => {
      expect(await rowKeys()).toEqual(["A", "B", "C", "D"])
    })
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
    // The counts are the first page's, never a later page's none.
    expect(screen.getByRole("radio", { name: /^All/ }).textContent).toContain("3")
  })

  it("says a further page that failed beside Load more, and reads it again on Try again", async () => {
    let fails = true
    let answer: (page: InstanceListData) => void = () => undefined
    renderScreen({
      list: (args: { after?: string }) => {
        if (args.after === undefined) return listOf({ rows: [row("a")], next: "c1" })
        if (fails) return Promise.reject(new Error("socket hang up"))
        return new Promise<InstanceListData>((resolve) => {
          answer = resolve
        })
      },
    })
    await rowKeys()
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "More instances couldn't be loadedTry again",
    )
    fails = false
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Try again" }))
    // The failure goes with its Try again: the focus waits on Load more, then the first new row.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Load more" }))
    })
    await act(async () => {
      answer(listOf({ rows: [row("b")], next: null, counts: null }))
    })
    await waitFor(async () => {
      expect(await rowKeys()).toEqual(["A", "B"])
    })
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("row", { name: "Instance B" }))
    })
  })

  it("leaves an ended session met by a further page to the frame's notice: no alert, Load more kept", async () => {
    renderScreen({
      list: (args: { after?: string }) => {
        if (args.after === undefined) return listOf({ rows: [row("a")], next: "c1" })
        throw new WebApiError(401, { code: "signed_out", message: "No session." })
      },
    })
    await rowKeys()
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Load more" }).getAttribute("aria-disabled"),
      ).toBeNull()
    })
    expect(screen.queryByRole("alert")).toBeNull()
    expect(await rowKeys()).toEqual(["A"])
  })

  it("offers no Try again for a further page no retry changes", async () => {
    renderScreen({
      list: (args: { after?: string }) => {
        if (args.after === undefined) return listOf({ rows: [row("a")], next: "c1" })
        return refusal("[REFUSED_CONDITION] no")
      },
    })
    await rowKeys()
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    const alert = await screen.findByRole("alert")
    expect(within(alert).queryByRole("button")).toBeNull()
  })

  it("starts the list over where its first page is read anew, a page answered for the list before left out", async () => {
    const pending: Array<(page: InstanceListData) => void> = []
    const { reads } = renderScreen({
      list: (args: { after?: string }) =>
        args.after === undefined
          ? listOf({ rows: [row("a")], next: "c1" })
          : new Promise<InstanceListData>((resolve) => {
              pending.push(resolve)
            }),
    })
    await rowKeys()
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => {
      expect(reads(INSTANCES_FEED)).toHaveLength(3)
    })
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Load more" }).getAttribute("aria-disabled"),
      ).toBeNull()
    })
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    await act(async () => {
      pending[0]?.(listOf({ rows: [row("late")], next: null, counts: null }))
    })
    expect(await rowKeys()).toEqual(["A"])
    await act(async () => {
      pending[1]?.(listOf({ rows: [row("b")], next: null, counts: null }))
    })
    await waitFor(async () => {
      expect(await rowKeys()).toEqual(["A", "B"])
    })
  })

  it("offers to clear the variable conditions of an empty list", async () => {
    const amount = { name: "amount", operator: "equals", value: "1" } as const
    const { onFilter } = renderScreen({
      filter: { scope: "running", variables: [amount] },
      list: listOf({ rows: [] }),
    })
    fireEvent.click(await screen.findByRole("button", { name: "Clear variable conditions" }))
    expect(onFilter).toHaveBeenLastCalledWith({ scope: "running" })
  })

  it("says a condition the engine refuses before any row, and offers to clear the conditions", async () => {
    const amount = { name: "amount", operator: "greaterThan", value: "1" } as const
    const { onFilter, reads } = renderScreen({
      filter: { scope: "running", variables: [amount] },
      list: refusal(
        '[REFUSED_CONDITION] Engine "c8" can\'t compare a variable by greater or less than.',
      ),
    })
    expect(
      await screen.findByText("The engine can't search with these variable conditions"),
    ).toBeTruthy()
    expect(reads(INSTANCES_FEED)).toHaveLength(1)
    fireEvent.click(screen.getByRole("button", { name: "Clear variable conditions" }))
    expect(onFilter).toHaveBeenLastCalledWith({ scope: "running" })
  })

  it("says a list that failed in the kit's words, with Try again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { reads } = renderScreen({ list: refusal("Something unexpected happened") })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(await screen.findByText("The instances couldn't be loaded")).toBeTruthy()
      const before = reads(INSTANCES_FEED).length
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Try again" }))
        await vi.advanceTimersByTimeAsync(10)
      })
      expect(reads(INSTANCES_FEED).length).toBeGreaterThan(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it("clears the element filter on Escape, but not from a field or with a dialog open", async () => {
    const { onFilter } = renderScreen({
      filter: { scope: "running", elementId: "Activity_ReviewOrder" },
    })
    await rowKeys()
    const main = document.querySelector<HTMLElement>("[data-slot=process-screen]")!
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search by business key" }), {
      key: "Escape",
    })
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Version" }), { key: "Escape" })
    fireEvent.keyDown(main, { key: "Enter" })
    expect(onFilter).not.toHaveBeenCalled()
    const dialog = document.createElement("dialog")
    dialog.setAttribute("open", "")
    document.body.append(dialog)
    fireEvent.keyDown(main, { key: "Escape" })
    expect(onFilter).not.toHaveBeenCalled()
    dialog.remove()
    fireEvent.keyDown(main, { key: "Escape" })
    expect(onFilter).toHaveBeenLastCalledWith({ scope: "running" })
    fireEvent.keyDown(main, { key: "Escape" })
    expect(onFilter).toHaveBeenCalledOnce()
  })

  it("reads the variable names once the condition dialog opens, never before", async () => {
    const { reads } = renderScreen()
    await rowKeys()
    expect(reads(VARIABLE_NAMES_FEED)).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "Filter by variables" }))
    await waitFor(() => {
      expect(reads(VARIABLE_NAMES_FEED)).toHaveLength(1)
    })
    expect(reads(VARIABLE_NAMES_FEED)[0]?.args).toEqual({
      engine: "prod-a",
      definitionId: "pulse-order:2",
    })
  })

  it("reads the versions and then the list over them again when the reader comes back after 60 s", async () => {
    let held = false
    let release = () => {}
    const { reads, order } = renderScreen({
      feed: () =>
        held
          ? new Promise((resolve) => {
              release = () => {
                resolve(answer())
              }
            })
          : answer(),
    })
    await rowKeys()
    held = true
    const now = Date.now()
    vi.spyOn(Date, "now").mockReturnValue(now + READ_AGAIN_AFTER_MS + 1)
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(() => {
      expect(reads(PROCESS_SCREEN_FEED)).toHaveLength(2)
    })
    // The list waits for the versions: its count is read after their running instances.
    expect(reads(INSTANCES_FEED)).toHaveLength(1)
    await act(async () => {
      release()
    })
    await waitFor(() => {
      expect(reads(INSTANCES_FEED)).toHaveLength(2)
    })
    expect(order()).toEqual([
      PROCESS_SCREEN_FEED,
      INSTANCES_FEED,
      PROCESS_SCREEN_FEED,
      INSTANCES_FEED,
    ])
    vi.restoreAllMocks()
  })
})

describe("the process feed's refusals", () => {
  it("tell a process the engine has no version of and a refused condition by their codes", () => {
    expect(isUnknownProcess(new Error("[UNKNOWN_PROCESS] x"))).toBe(true)
    expect(isUnknownProcess(new Error("[UNKNOWN_INSTANCE] x"))).toBe(false)
    expect(isUnknownProcess("[UNKNOWN_PROCESS] x")).toBe(false)
    expect(isRefusedCondition(new Error("[REFUSED_CONDITION] x"))).toBe(true)
    expect(isRefusedCondition("[REFUSED_CONDITION] x")).toBe(false)
  })
})
