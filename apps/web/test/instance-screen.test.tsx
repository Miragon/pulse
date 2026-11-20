// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { useRef } from "react"
import type * as Widgets from "@miragon/pulse-widget-shell/widgets"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  TestViewHost,
  WebApiError,
  type HostAction,
  type UseBpmnViewerResult,
} from "@miragon/pulse-widget-shell/widgets"
import type { InstanceScreenData } from "@miragon/pulse-screens"
import { NavigationFocus } from "@miragon/pulse-ui"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import type { InstanceTab } from "../src/router/routes.js"
import { preselectedTab } from "../src/screens/instance/instance-details.js"
import {
  BPMN_XML_FEED,
  INCIDENT_DETAIL_FEED,
  INCIDENT_TEXT_FEED,
  INSTANCE_SCREEN_FEED,
  isUnknownIncident,
  isUnknownInstance,
} from "../src/screens/instance/instance-feed.js"
import { IncidentResolve, incidentUrlOf } from "../src/screens/instance/incident-resolve.js"
import { InstanceScreen } from "../src/screens/instance/instance-screen.js"

/**
 * The web app's instance screen over the kit world's instance screens (WORLD_SCREENS of
 * @miragon/pulse-screens/testing: DSP-3001, which waits at its call activity for the root incident
 * of the instance it called, and that instance; the numbers the editors' instance view shows of the
 * same world and the server's feed builds of the recorded engines, instance-screen-data.numbers.test
 * in the engine connector): its bar and strips, its tabs and the one it opens on, its incident cards
 * with their text read in place and their ways on, the caller, a focus on an incident it does not
 * hold, its refusals, German, and no write. The diagram's drawing runs in test:web.
 */

const writeText = vi.fn<(text: string) => Promise<void>>()

// The kit's BPMN viewer draws in a real browser alone (test:web); here a canvas that draws nothing.
vi.mock("@miragon/pulse-widget-shell/widgets", async (original) => ({
  ...(await original<typeof Widgets>()),
  useBpmnViewer: (): UseBpmnViewerResult => ({
    containerRef: useRef<HTMLDivElement>(null),
    height: 320,
    importError: null,
    zoomIn: () => {},
    zoomOut: () => {},
    fit: () => {},
  }),
}))

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
})

afterEach(cleanup)

const CAUSE = {
  incidentId: "incident-of-fake-label-of-DSP-3001",
  activityId: "Activity_RenderLabel",
  incidentType: "failedTask",
  signature: "cannot resolve identifier",
}

const WEB_APP = {
  url: "https://ops.example/cockpit/#/process-instance/fake-DSP-3001",
  vendor: "CIB seven",
}

/** The feed's answer: a world's screen with the server's enrichments. */
const answer = (
  data: InstanceScreenData = WORLD_SCREENS.instance,
  more: Record<string, unknown> = {},
) => ({ ...data, webApp: WEB_APP, causes: [CAUSE], ...more })

/** The stack trace the text feed reads, its root cause on its second line. */
const TEXT = {
  incidentId: CAUSE.incidentId,
  kind: "stacktrace",
  text: "java.lang.RuntimeException: wrapped\nCaused by: MissingBean: Cannot resolve identifier\n\tat a.B.c(B.java:1)",
  truncated: false,
  rootCause: "MissingBean: Cannot resolve identifier",
  rootCauseLine: 1,
}

/** A refusal of the server as a feed's result says it. */
const refusal = (text: string) => ({ isError: true, content: [{ type: "text", text }] })

function renderScreen({
  feed = answer(),
  locale = "en",
  instance = "fake-DSP-3001",
  tab,
  incident,
  tools = {},
}: {
  feed?: unknown
  locale?: string
  instance?: string
  tab?: InstanceTab
  incident?: string
  tools?: Record<string, unknown>
} = {}) {
  const actions: HostAction[] = []
  const navigate = vi.fn<(url: string) => void>()
  const onTab = vi.fn<(tab: InstanceTab) => void>()
  render(
    <TestViewHost
      tools={{
        [INSTANCE_SCREEN_FEED]: feed,
        [BPMN_XML_FEED]: { processDefinitionId: "pulse-dispatch:1", bpmnXml: null },
        [INCIDENT_TEXT_FEED]: TEXT,
        ...tools,
      }}
      onHostAction={(action) => actions.push(action)}
      locale={locale}
      host={{ timeZone: "UTC" }}
      writes={false}
      followUp="none"
      startPage="/app"
    >
      <InstanceScreen
        engine="prod-a"
        instance={instance}
        {...(tab === undefined ? {} : { tab })}
        {...(incident === undefined ? {} : { incident })}
        navigate={navigate}
        onTab={onTab}
      />
    </TestViewHost>,
  )
  const reads = (name: string) =>
    actions.filter((action) => action.type === "callTool" && action.name === name)
  return { navigate, onTab, reads }
}

/** The page's heading, once the screen read the instance (its tabs show). */
async function heading(): Promise<HTMLElement> {
  await screen.findByRole("tab", { name: /^History|^Verlauf/ })
  return screen.getByRole("heading", { level: 1 })
}
const cardOf = () => screen.getByRole("article")

describe("the instance screen", () => {
  it("heads the page with the business key, the state, the facts, the Refresh, the web app and when it was read", async () => {
    renderScreen()
    expect((await heading()).textContent).toBe("DSP-3001")
    const bar = (await heading()).closest<HTMLElement>("[data-slot=view-bar]")!
    expect(within(bar).getByText("Running")).toBeTruthy()
    const version = within(bar).getByRole("link", { name: "Dispatch order v1" })
    expect(version.getAttribute("href")).toBe("/app/engines/prod-a/processes/pulse-dispatch")
    expect(within(bar).getByText("prod-a")).toBeTruthy()
    expect(within(bar).getByRole("button", { name: "Refresh" })).toBeTruthy()
    expect(
      within(bar)
        .getByRole("link", { name: /Open in CIB seven/ })
        .getAttribute("href"),
    ).toBe(WEB_APP.url)
    expect(bar.querySelector("[data-slot=freshness-stamp]")?.textContent).toMatch(/^As of/)
  })

  it("says where it stands and opens on its incidents, whose card says where the root incident lies", async () => {
    renderScreen()
    await heading()
    expect(
      screen.getByText(
        /^Waits at Activity_PrintShippingLabel on an incident in a called instance since/,
      ),
    ).toBeTruthy()
    const incidents = screen.getByRole("tab", { name: /^Incidents/ })
    expect(incidents.getAttribute("aria-selected")).toBe("true")
    const card = cardOf()
    expect(card.textContent).toContain("MissingBean: Cannot resolve identifier")
    const liesIn = within(card).getByRole("link", { name: /pulse-label fake-label-of-DSP-3001/ })
    expect(liesIn.getAttribute("href")).toBe(
      "/app/engines/prod-a/instances/fake-label-of-DSP-3001/incidents/incident-of-fake-label-of-DSP-3001",
    )
    const open = within(card).getByRole("link", { name: "Open incident" })
    expect(open.getAttribute("href")).toBe(liesIn.getAttribute("href"))
    expect(within(card).queryByRole("link", { name: "All with this cause" })).toBeNull()
  })

  it("reads a card's stack trace only when it opens, once, and marks its root cause's line", async () => {
    const { reads } = renderScreen()
    await heading()
    expect(reads(INCIDENT_TEXT_FEED)).toHaveLength(0)
    fireEvent.click(within(cardOf()).getByRole("button", { name: "Show stacktrace" }))
    const marked = await screen.findByText(/Caused by: MissingBean/)
    expect(marked.closest("[data-part=root-cause-line]")).not.toBeNull()
    fireEvent.click(within(cardOf()).getByRole("button", { name: "Hide stacktrace" }))
    fireEvent.click(within(cardOf()).getByRole("button", { name: "Show stacktrace" }))
    expect(reads(INCIDENT_TEXT_FEED)).toHaveLength(1)
    expect(JSON.stringify(reads(INCIDENT_TEXT_FEED)[0])).toContain(
      JSON.stringify({ engine: "prod-a", incident: CAUSE.incidentId }),
    )
  })

  it("puts an incident in focus: its card's text open at once, every incident with its cause", async () => {
    const { reads } = renderScreen({ incident: CAUSE.incidentId })
    await heading()
    expect(await screen.findByText(/Caused by: MissingBean/)).toBeTruthy()
    expect(reads(INCIDENT_TEXT_FEED)).toHaveLength(1)
    const card = cardOf()
    expect(within(card).queryByRole("link", { name: "Open incident" })).toBeNull()
    expect(
      within(card).getByRole("link", { name: "All with this cause" }).getAttribute("href"),
    ).toBe(
      "/app/engines/prod-a/incidents/cause?activity=Activity_RenderLabel&type=failedTask&signature=cannot+resolve+identifier",
    )
    expect(screen.getByRole("tab", { name: /^Incidents/ }).getAttribute("aria-selected")).toBe(
      "true",
    )
  })

  it("scrolls the card in focus into sight after the frame moved focus to the page's heading", async () => {
    // Where the instance is read already, the card shows in the commit in which the frame moves the
    // focus to the heading, which scrolls the page up to it: the card's scroll must come after.
    const seen: string[] = []
    const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView")
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value(this: Element) {
        seen.push(
          `${this.getAttribute("data-focus") ?? "-"} ${document.activeElement?.tagName ?? ""}`,
        )
      },
    })
    try {
      const Page = ({ incident }: { incident?: string }) => (
        <TestViewHost
          tools={{ [INSTANCE_SCREEN_FEED]: answer(), [INCIDENT_TEXT_FEED]: TEXT }}
          locale="en"
          writes={false}
          followUp="none"
        >
          <NavigationFocus viewKey={incident ?? "instance"}>
            <InstanceScreen
              engine="prod-a"
              instance="fake-DSP-3001"
              {...(incident === undefined ? {} : { incident })}
              navigate={vi.fn()}
              onTab={vi.fn()}
            />
          </NavigationFocus>
        </TestViewHost>
      )
      const view = render(<Page />)
      await heading()
      seen.length = 0
      view.rerender(<Page incident={CAUSE.incidentId} />)
      await waitFor(() => expect(seen).toEqual(["true H1"]))
    } finally {
      if (original === undefined) Reflect.deleteProperty(Element.prototype, "scrollIntoView")
      else Object.defineProperty(Element.prototype, "scrollIntoView", original)
    }
  })

  it("says an incident in focus is not open in this instance, and links to the instance", async () => {
    const { navigate } = renderScreen({ incident: "inc-gone" })
    await heading()
    const strip = document.querySelector<HTMLElement>("[data-slot=incident-missing]")!
    expect(within(strip).getByRole("status").textContent).toBe(
      "Incident inc-gone isn't open in this instance. It may be resolved already. The instance shows the incidents it has now.",
    )
    const link = within(strip).getByRole("link", { name: "Show the instance" })
    expect(link.getAttribute("href")).toBe("/app/engines/prod-a/instances/fake-DSP-3001")
    fireEvent.click(link)
    expect(navigate).toHaveBeenCalledWith("/app/engines/prod-a/instances/fake-DSP-3001")
  })

  it("names the caller of a called instance and its process, with the way to it", async () => {
    renderScreen({ feed: answer(WORLD_SCREENS.calledInstance), instance: "fake-label-of-DSP-3001" })
    expect((await heading()).textContent).toBe("fake-label-of-DSP-3001")
    const strip = document.querySelector<HTMLElement>("[data-slot=caller-strip]")!
    expect(strip.textContent).toContain("Called by DSP-3001")
    expect(strip.textContent).toContain("Dispatch order v1")
    expect(within(strip).getByRole("link", { name: "Open caller" }).getAttribute("href")).toBe(
      "/app/engines/prod-a/instances/fake-DSP-3001",
    )
  })

  it("shows an em dash for the caller's process where its read failed, and says so in words", async () => {
    const called = WORLD_SCREENS.calledInstance
    renderScreen({
      feed: answer({
        ...called,
        caller: { instanceId: "fake-DSP-3001", found: null },
        unread: ["caller"],
      }),
      instance: called.instance.id,
    })
    await heading()
    const strip = document.querySelector<HTMLElement>("[data-slot=caller-strip]")!
    expect(strip.textContent).toContain("Called by fake-DSP-3001")
    expect(within(strip).getByText("—").getAttribute("aria-hidden")).toBe("true")
    expect(within(strip).getByText("The caller's process couldn't be read")).toBeTruthy()
  })

  it("opens on the waits of a running instance without incidents, and on the history of an ended one", () => {
    const running = WORLD_SCREENS.instance
    expect(preselectedTab({ ...running, incidents: [] })).toBe("waiting")
    expect(
      preselectedTab({ incidents: [], instance: { ...running.instance, state: "completed" } }),
    ).toBe("history")
    expect(preselectedTab(running)).toBe("incidents")
  })

  it("opens on the tab the address names, and hands a pick of a tab to the page", async () => {
    const { onTab } = renderScreen({ tab: "variables" })
    await heading()
    expect(screen.getByRole("tab", { name: /^Variables/ }).getAttribute("aria-selected")).toBe(
      "true",
    )
    expect(screen.getByRole("table", { name: "Variables" }).textContent).toContain("orderId")
    const history = screen.getByRole("tab", { name: /^History/ })
    fireEvent.mouseDown(history, { button: 0 })
    fireEvent.click(history)
    expect(onTab).toHaveBeenCalledWith("history")
  })

  it("refuses an instance the engine does not know once, with the way to the engine's processes and no Try again", async () => {
    const { reads } = renderScreen({
      feed: refusal('[UNKNOWN_INSTANCE] Instance "pi-x" is not on engine "prod-a".'),
      instance: "pi-x",
    })
    expect(await screen.findByText("Instance pi-x isn't on engine prod-a")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
    expect(screen.getByRole("link", { name: "Processes of prod-a" }).getAttribute("href")).toBe(
      "/app/engines/prod-a",
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(reads(INSTANCE_SCREEN_FEED)).toHaveLength(1)
  })

  it("offers Try again for a failure a retry may change", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderScreen({ feed: refusal("[503] Engine prod-a is unreachable") })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it("speaks German where the page does", async () => {
    renderScreen({
      feed: answer(WORLD_SCREENS.calledInstance),
      instance: "fake-label-of-DSP-3001",
      locale: "de",
    })
    await heading()
    const tabs = screen.getAllByRole("tab").map((one) => one.textContent?.replace(/\d+$/, ""))
    expect(tabs).toEqual(["Verlauf", "Incidents", "Wartet", "Variablen"])
    expect(document.querySelector("[data-slot=caller-strip]")?.textContent).toContain(
      "Aufgerufen von DSP-3001",
    )
    expect(screen.getByRole("link", { name: "Aufrufer öffnen" })).toBeTruthy()
  })

  it("offers no write and no hand-off: no retry, no editor, no move, no chat", async () => {
    renderScreen()
    await heading()
    const controls = screen.getAllByRole("button").map((button) => button.textContent ?? "")
    expect(controls.filter((text) => /retry|edit|move|resolve|chat/i.test(text))).toEqual([])
    expect(document.body.textContent).not.toMatch(/\bchat\b/i)
  })

  it("says it has no diagram where the engine has none for its version", async () => {
    renderScreen()
    expect(await screen.findByText("The engine has no diagram for this version.")).toBeTruthy()
  })
})

describe("the instance screen's parts beside its rows", () => {
  it("copies the whole id of an instance without a business key, and says so", async () => {
    renderScreen({ feed: answer(WORLD_SCREENS.calledInstance), instance: "fake-label-of-DSP-3001" })
    await heading()
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy instance ID" }))
    })
    expect(writeText).toHaveBeenCalledWith("fake-label-of-DSP-3001")
    expect(await screen.findByText("Copied the instance ID")).toBeTruthy()
  })

  it("says a copy the browser refused, and where it has no clipboard at all", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    renderScreen()
    await heading()
    await act(async () => {
      fireEvent.click(within(cardOf()).getByRole("button", { name: "Copy incident ID" }))
    })
    expect(await screen.findByText("Couldn't copy the incident ID")).toBeTruthy()
    cleanup()
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined })
    renderScreen()
    await heading()
    await act(async () => {
      fireEvent.click(within(cardOf()).getByRole("button", { name: "Copy job ID" }))
    })
    expect(await screen.findByText("Couldn't copy the job ID")).toBeTruthy()
  })

  it("reads a text again on the reader's retry after a failed read, never by itself", async () => {
    let reads = 0
    renderScreen({
      tools: {
        [INCIDENT_TEXT_FEED]: () => {
          reads += 1
          return reads === 1 ? refusal("[503] Engine prod-a is unreachable") : TEXT
        },
      },
    })
    await heading()
    fireEvent.click(within(cardOf()).getByRole("button", { name: "Show stacktrace" }))
    expect(await screen.findByText("Pulse couldn't read the text.")).toBeTruthy()
    expect(reads).toBe(1)
    fireEvent.click(within(cardOf()).getByRole("button", { name: "Try again" }))
    expect(await screen.findByText(/Caused by: MissingBean/)).toBeTruthy()
    expect(reads).toBe(2)
  })

  it("says a text the engine no longer has once, with no Try again", async () => {
    const { reads } = renderScreen({
      tools: {
        [INCIDENT_TEXT_FEED]: refusal(
          `[UNKNOWN_INCIDENT] Incident "${CAUSE.incidentId}" on engine "prod-a" has no text the engine gives.`,
        ),
      },
    })
    await heading()
    fireEvent.click(within(cardOf()).getByRole("button", { name: "Show stacktrace" }))
    expect(
      await within(cardOf()).findByText(
        "The engine has no text for this incident. It may be resolved already. Refresh the instance.",
      ),
    ).toBeTruthy()
    expect(within(cardOf()).queryByRole("button", { name: "Try again" })).toBeNull()
    expect(within(cardOf()).queryByRole("alert")).toBeNull()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(reads(INCIDENT_TEXT_FEED)).toHaveLength(1)
  })

  it("leaves a page's ended session to the frame: a quiet line in the card, no Try again", async () => {
    renderScreen({
      tools: {
        [INCIDENT_TEXT_FEED]: () => {
          throw new WebApiError(401, { code: "signed_out", message: "No session." })
        },
      },
    })
    await heading()
    fireEvent.click(within(cardOf()).getByRole("button", { name: "Show stacktrace" }))
    expect(await within(cardOf()).findByText("This content couldn't be loaded")).toBeTruthy()
    expect(within(cardOf()).queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("says another refusal of the kit in its words, with no Try again", async () => {
    renderScreen({
      tools: {
        [INCIDENT_TEXT_FEED]: refusal(
          '[ENGINE_PROFILE_REFUSED] Engine "prod-a" was refused: auth.tokenEnv names no variable.',
        ),
      },
    })
    await heading()
    fireEvent.click(within(cardOf()).getByRole("button", { name: "Show stacktrace" }))
    const said = await within(cardOf()).findByRole("status")
    await waitFor(() => expect(said.textContent).toMatch(/refused/i))
    expect(within(cardOf()).queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("offers a stack trace wherever an incident has a job, and no text where it has neither", async () => {
    const [card] = WORLD_SCREENS.instance.incidents
    if (card === undefined) throw new Error("The world's instance has an incident")
    const unread = { ...card, text: null }
    renderScreen({ feed: answer({ ...WORLD_SCREENS.instance, incidents: [unread] }) })
    await heading()
    expect(within(cardOf()).getByRole("button", { name: "Show stacktrace" })).toBeTruthy()
    cleanup()
    const { job, ...jobless } = unread
    expect(job).toBeDefined()
    renderScreen({ feed: answer({ ...WORLD_SCREENS.instance, incidents: [jobless] }) })
    await heading()
    expect(within(cardOf()).queryByRole("button", { name: /stacktrace|error message/ })).toBeNull()
  })

  it("says an instance has no open incidents on its incidents tab", async () => {
    renderScreen({
      feed: answer({ ...WORLD_SCREENS.instance, incidents: [] }),
      tab: "incidents",
    })
    await heading()
    expect(screen.getByText("This instance has no open incidents.")).toBeTruthy()
  })

  it("says a cut list once, under the bar", async () => {
    renderScreen({ feed: answer({ ...WORLD_SCREENS.instance, truncated: true }) })
    await heading()
    expect(
      screen.getByText("Some lists are cut off, so Pulse shows only part of them."),
    ).toBeTruthy()
  })

  it("says a failed refresh under the bar, the instance on screen, no Try again for a refusal", async () => {
    let reads = 0
    renderScreen({
      feed: () => {
        reads += 1
        return reads === 1
          ? answer()
          : refusal('[UNKNOWN_INSTANCE] Instance "fake-DSP-3001" is not on engine "prod-a".')
      },
    })
    await heading()
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })))
    expect(await screen.findByText("Couldn't refresh this view")).toBeTruthy()
    expect(screen.getByRole("tab", { name: /^Incidents/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  it("draws the diagram where the engine has one, and says why it draws none", async () => {
    renderScreen({ tools: { [BPMN_XML_FEED]: { bpmnXml: "<bpmn:definitions/>" } } })
    await heading()
    await waitFor(() => {
      expect(document.querySelector("[data-slot=instance-diagram]")).not.toBeNull()
    })
    cleanup()
    renderScreen({ tools: { [BPMN_XML_FEED]: refusal("[503] Engine prod-a is unreachable") } })
    await heading()
    expect(
      await screen.findByText("The diagram couldn't be loaded. Refresh to try again."),
    ).toBeTruthy()
    cleanup()
    const reads = renderScreen({
      feed: answer({ ...WORLD_SCREENS.instance, unread: ["diagram"] }),
    }).reads
    await heading()
    expect(screen.getByText("The diagram couldn't be loaded. Refresh to try again.")).toBeTruthy()
    expect(reads(BPMN_XML_FEED)).toHaveLength(0)
    cleanup()
    renderScreen({ tools: { [BPMN_XML_FEED]: () => new Promise(() => {}) } })
    await heading()
    expect(screen.getByText("Loading the diagram…")).toBeTruthy()
  })

  it("reads a failed diagram again on Refresh, and draws it", async () => {
    let xmlReads = 0
    const { reads } = renderScreen({
      tools: {
        [BPMN_XML_FEED]: () => {
          xmlReads += 1
          return xmlReads === 1
            ? refusal("[503] Engine prod-a is unreachable")
            : { bpmnXml: "<bpmn:definitions/>" }
        },
      },
    })
    await heading()
    expect(
      await screen.findByText("The diagram couldn't be loaded. Refresh to try again."),
    ).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })))
    await waitFor(() => {
      expect(document.querySelector("[data-slot=instance-diagram]")).not.toBeNull()
    })
    expect(reads(BPMN_XML_FEED)).toHaveLength(2)
    expect(reads(INSTANCE_SCREEN_FEED)).toHaveLength(2)
    // A diagram on screen is not read again by the next Refresh: its version does not change.
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })))
    await waitFor(() => expect(reads(INSTANCE_SCREEN_FEED)).toHaveLength(3))
    expect(reads(BPMN_XML_FEED)).toHaveLength(2)
  })

  it("reads a failed diagram again when the reader comes back after 60 s, never before", async () => {
    const start = new Date("2026-11-19T09:00:00Z").getTime()
    // Only the clock: the reads and the test's waits keep real timers.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(start)
    try {
      let xmlReads = 0
      const { reads } = renderScreen({
        tools: {
          [BPMN_XML_FEED]: () => {
            xmlReads += 1
            return xmlReads === 1
              ? refusal("[503] Engine prod-a is unreachable")
              : { bpmnXml: "<bpmn:definitions/>" }
          },
        },
      })
      await heading()
      await screen.findByText("The diagram couldn't be loaded. Refresh to try again.")
      vi.setSystemTime(start + 59_000)
      await act(async () => fireEvent.focus(window))
      expect(reads(BPMN_XML_FEED)).toHaveLength(1)
      vi.setSystemTime(start + 61_000)
      await act(async () => fireEvent.focus(window))
      await waitFor(() => {
        expect(document.querySelector("[data-slot=instance-diagram]")).not.toBeNull()
      })
      expect(reads(BPMN_XML_FEED)).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("splits the diagram and the details from 64rem on, and stacks them under it", async () => {
    const width = (matches: boolean) => () => ({
      matches,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
    try {
      vi.stubGlobal("matchMedia", width(true))
      renderScreen()
      await heading()
      expect(screen.getByRole("separator", { name: "Resize diagram and details" })).toBeTruthy()
      cleanup()
      vi.stubGlobal("matchMedia", width(false))
      renderScreen()
      await heading()
      expect(screen.queryByRole("separator")).toBeNull()
      expect(screen.getByRole("tab", { name: /^Incidents/ })).toBeTruthy()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("names elements by the rows where the diagram does not, and processes by their ids without a name", async () => {
    const called = WORLD_SCREENS.calledInstance
    const [own] = called.incidents
    const definition = { id: "pulse-label:1", bpmnProcessId: "pulse-label", version: 1 }
    renderScreen({
      feed: answer({
        ...called,
        instance: { ...called.instance, definition },
        caller: {
          instanceId: "fake-DSP-3001",
          found: {
            state: "running",
            definition: { id: "pulse-dispatch:1", bpmnProcessId: "pulse-dispatch", version: 1 },
          },
        },
        path: called.path.map((row) => ({ ...row, elementName: `the ${row.elementId}` })),
      }),
      instance: called.instance.id,
      incident: own?.rootIncident.id,
      tools: { [BPMN_XML_FEED]: { bpmnXml: "<bpmn:definitions/>" } },
    })
    await heading()
    expect(document.querySelector("[data-slot=caller-strip]")?.textContent).toContain(
      "pulse-dispatch v1",
    )
    expect(cardOf().getAttribute("aria-label")).toBe(`Failed task at the ${String(own?.elementId)}`)
    await waitFor(() => {
      expect(document.querySelector("[data-slot=instance-diagram]")).not.toBeNull()
    })
  })

  it("marks no line of a text whose root cause the read does not place", async () => {
    renderScreen({
      incident: CAUSE.incidentId,
      tools: { [INCIDENT_TEXT_FEED]: { ...TEXT, rootCause: null, rootCauseLine: null } },
    })
    await heading()
    expect(await screen.findByText(/Caused by: MissingBean/)).toBeTruthy()
    expect(document.querySelector("[data-part=root-cause-line]")).toBeNull()
  })
})

describe("an incident the page knows by its id alone", () => {
  it("leads to the instance that holds its root: a copy's root, or the incident itself", () => {
    expect(
      incidentUrlOf("prod-a", "copy-1", {
        processInstanceId: "pi-caller",
        rootCause: { incidentId: "root-1", processInstanceId: "pi-called" },
      }),
    ).toBe("/app/engines/prod-a/instances/pi-called/incidents/root-1")
    expect(incidentUrlOf("prod-a", "root-1", { processInstanceId: "pi-1", rootCause: null })).toBe(
      "/app/engines/prod-a/instances/pi-1/incidents/root-1",
    )
  })

  it("says a failed read, and reads again on Try again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let reads = 0
      render(
        <TestViewHost
          tools={{
            [INCIDENT_DETAIL_FEED]: () => {
              reads += 1
              return refusal("[503] Engine prod-a is unreachable")
            },
          }}
          locale="en"
          writes={false}
          followUp="none"
        >
          <IncidentResolve engine="prod-a" incident="copy-1" navigate={vi.fn()} ready />
        </TestViewHost>,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      const retry = await screen.findByRole("button", { name: "Try again" })
      const before = reads
      await act(async () => {
        fireEvent.click(retry)
        await vi.advanceTimersByTimeAsync(10)
      })
      expect(reads).toBeGreaterThan(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it("titles a failure the kit cannot classify by what it tried, never as an incident not found", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(
        <TestViewHost
          tools={{ [INCIDENT_DETAIL_FEED]: refusal("Something unexpected happened") }}
          locale="en"
          writes={false}
          followUp="none"
        >
          <IncidentResolve engine="prod-a" incident="copy-1" navigate={vi.fn()} ready />
        </TestViewHost>,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(
        await screen.findByText("The instance of incident copy-1 couldn't be loaded"),
      ).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it("names the page's entry anew with that address once it read the incident", async () => {
    const navigate = vi.fn<(url: string, entry?: "push" | "replace") => void>()
    render(
      <TestViewHost
        tools={{
          [INCIDENT_DETAIL_FEED]: {
            processInstanceId: "pi-caller",
            rootCause: { incidentId: "root-1", processInstanceId: "pi-called" },
          },
        }}
        locale="en"
        writes={false}
        followUp="none"
      >
        <IncidentResolve engine="prod-a" incident="copy-1" navigate={navigate} ready />
      </TestViewHost>,
    )
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("Incident copy-1")
    await vi.waitFor(() => {
      expect(navigate).toHaveBeenCalledWith(
        "/app/engines/prod-a/instances/pi-called/incidents/root-1",
        "replace",
      )
    })
  })
})

describe("the refusal of an instance the engine does not know", () => {
  it("is the feed's code at the head of its text, and nothing else", () => {
    expect(isUnknownInstance(new Error('[UNKNOWN_INSTANCE] Instance "x"'))).toBe(true)
    expect(isUnknownInstance(new Error("Engine said [UNKNOWN_INSTANCE]"))).toBe(false)
    expect(isUnknownInstance("[UNKNOWN_INSTANCE]")).toBe(false)
  })
})

describe("the refusal of an incident's text the engine does not have", () => {
  it("is the feed's code at the head of its text, and nothing else", () => {
    expect(isUnknownIncident(new Error('[UNKNOWN_INCIDENT] Incident "x"'))).toBe(true)
    expect(isUnknownIncident(new Error("Engine said [UNKNOWN_INCIDENT]"))).toBe(false)
    expect(isUnknownIncident("[UNKNOWN_INCIDENT]")).toBe(false)
  })
})
