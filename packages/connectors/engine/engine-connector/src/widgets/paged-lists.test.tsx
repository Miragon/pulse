// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { createElement, type ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  ENGINE_CLUSTER_DETAIL_DATA,
  ENGINE_PROCESS_INSTANCES_DATA,
  ENGINE_WIDGET_ACTIONS_DATA,
} from "../tool-names.js"
import type { ClusterDetailData, ProcessInstancesData } from "../view-models.js"
import { ClusterDetailWidget } from "./cluster-detail.js"
import { ProcessInstancesWidget } from "./process-instances/list.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"
import {
  TestViewHost,
  type HostAction,
  createTestQueryClient,
} from "@miragon/pulse-widget-shell/widgets"

// One retry-free client per test; the test reads and pokes its cache.
let queryClient = createTestQueryClient()

// The real query stack (#341). N123: a pending new page 0 keeps the list and search box mounted
// with the previous rows. N130: a page-0 failure over rows is its own error, retrying page 0.

afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

function deferredFeed<T>() {
  const calls: Array<{ args: Record<string, unknown>; resolve: (value: T) => void }> = []
  const handler = (args: Record<string, unknown>) =>
    new Promise<T>((resolve) => {
      calls.push({ args, resolve })
    })
  return { calls, handler }
}

function instances(ids: string[], total: number): ProcessInstancesData {
  return {
    processDefinitionKey: "invoice",
    processDefinitionName: "Invoice",
    totalCount: total,
    returnedCount: ids.length,
    allCount: total,
    withIncidentCount: 0,
    suspendedCount: 0,
    instances: ids.map((id) => ({
      id,
      businessKey: `BK-${id}`,
      processDefinitionKey: "invoice",
      processDefinitionName: null,
      version: 1,
      suspended: false,
      hasIncident: false,
    })),
    filters: {},
    engineId: "prod-a",
  }
}

const CLUSTER: ClusterDetailData = {
  activityId: "callWMS",
  activityName: null,
  incidentType: "failedExternalTask",
  messageSignature: "connection timeout",
  incidentCount: 2,
  scannedIncidentCount: 2,
  lastHourCount: 1,
  last24hCount: 2,
  firstSeen: "2026-06-11T08:00:00.000Z",
  latestIncident: "2026-06-11T14:00:00.000Z",
  processDefinitionKeys: ["shipping"],
  representativeMessage: "Connection timeout",
  incidents: [
    {
      incidentId: "inc-1",
      processInstanceId: "pi-1",
      businessKey: "ORDER-4711",
      processDefinitionKey: "shipping",
      processDefinitionName: null,
      incidentTimestamp: "2026-06-11T14:00:00.000Z",
    },
    {
      incidentId: "inc-2",
      processInstanceId: "pi-2",
      businessKey: "ORDER-4712",
      processDefinitionKey: "shipping",
      processDefinitionName: null,
      incidentTimestamp: "2026-06-11T13:00:00.000Z",
    },
  ],
  totalMatching: 2,
  fetchedAt: "2026-06-11T14:05:00.000Z",
  engineId: "prod-a",
}

function host(widget: ComponentType<Record<string, unknown>>, tools: Record<string, unknown>) {
  render(
    <TestViewHost tools={tools} client={queryClient}>
      {createElement(widget)}
    </TestViewHost>,
  )
}

describe("a search keeps the list and its search box mounted while page 0 is in flight (N123)", () => {
  it("process instances (search and chip)", async () => {
    const feed = deferredFeed<ProcessInstancesData>()
    const Widget = () => (
      <ProcessInstancesWidget
        data={instances(["pi-1", "pi-2"], 2)}
        processDefinitionKey="invoice"
        engine="prod-a"
      />
    )
    host(Widget, { [ENGINE_PROCESS_INSTANCES_DATA]: feed.handler })

    const search = screen.getByRole("searchbox", { name: "Search by business key or ID" })
    fireEvent.click(screen.getByRole("button", { name: /^With incident \d/ }))
    await waitFor(() => expect(feed.calls).toHaveLength(1))
    expect(feed.calls[0].args).toMatchObject({ withIncidents: true })
    expect(search.isConnected).toBe(true)
    expect(screen.getByText("BK-pi-2")).toBeTruthy()

    feed.calls[0].resolve(instances(["pi-2"], 1))
    await waitFor(() => expect(screen.queryByText("BK-pi-1")).toBeNull())

    fireEvent.change(search, { target: { value: "BK-9" } })
    await waitFor(() => expect(feed.calls).toHaveLength(2), { timeout: 2_000 })
    expect(feed.calls[1].args).toMatchObject({ search: "BK-9", withIncidents: true })
    expect(search.isConnected).toBe(true)
    expect(screen.getByText("BK-pi-2")).toBeTruthy()
  })

  it("cluster detail", async () => {
    const feed = deferredFeed<ClusterDetailData>()
    const Widget = () => (
      <ClusterDetailWidget
        data={CLUSTER}
        engine="prod-a"
        activityId={CLUSTER.activityId}
        incidentType={CLUSTER.incidentType}
        messageSignature={CLUSTER.messageSignature ?? undefined}
      />
    )
    host(Widget, { [ENGINE_CLUSTER_DETAIL_DATA]: feed.handler })

    const search = screen.getByRole("searchbox", { name: "Filter by business key" })
    fireEvent.change(search, { target: { value: "4711" } })
    await waitFor(() => expect(feed.calls).toHaveLength(1), { timeout: 2_000 })
    expect(feed.calls[0].args).toMatchObject({ businessKeyLike: "4711" })
    expect(search.isConnected).toBe(true)
    expect(screen.getByText("ORDER-4712")).toBeTruthy()

    feed.calls[0].resolve({ ...CLUSTER, incidents: [CLUSTER.incidents[0]], totalMatching: 1 })
    await waitFor(() => expect(screen.queryByText("ORDER-4712")).toBeNull())
    expect(screen.getByText("ORDER-4711")).toBeTruthy()
  })
})

describe("a page-0 failure over rows on screen is not a load-more failure (N130)", () => {
  function selfFetchingList() {
    const state = { failPage0: false, failMore: false }
    const calls: Array<Record<string, unknown>> = []
    const feed = (args: Record<string, unknown>) => {
      calls.push(args)
      const more = (args.firstResult as number) > 0
      if (more ? state.failMore : state.failPage0) {
        throw new Error(more ? "page 2 timed out" : "engine down")
      }
      return more ? instances(["pi-3"], 5) : instances(["pi-1", "pi-2"], 5)
    }
    const Widget = () => <ProcessInstancesWidget data={null} engine="prod-a" />
    host(Widget, { [ENGINE_PROCESS_INSTANCES_DATA]: feed })
    return { state, calls }
  }

  it("a failed refetch keeps the rows, says so, and its retry re-runs page 0", async () => {
    const { state, calls } = selfFetchingList()
    await screen.findByText("BK-pi-1")

    // A write elsewhere invalidated the cockpit's lists; the refetch fails.
    state.failPage0 = true
    await queryClient.invalidateQueries({ queryKey: ["engine:process-instances"] })

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Couldn't update the list")
    expect(alert.textContent).toContain("You're seeing the previous result.")
    expect(alert.querySelector("details pre")?.textContent).toBe("engine down")
    expect(alert.textContent).not.toContain("Couldn't load more entries")
    expect(screen.getByText("BK-pi-1")).toBeTruthy()

    state.failPage0 = false
    const before = calls.length
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
    // Page 0, not the next offset.
    expect(calls.slice(before)).toEqual([expect.objectContaining({ firstResult: 0 })])
  })

  it("a failed Load more says so, and its retry fetches the next offset", async () => {
    const { state, calls } = selfFetchingList()
    await screen.findByText("BK-pi-1")

    state.failMore = true
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Couldn't load more entries")
    expect(alert.textContent).toContain("The entries above are current.")
    expect(alert.querySelector("details pre")?.textContent).toBe("page 2 timed out")
    expect(alert.textContent).not.toContain("Couldn't update the list")

    state.failMore = false
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }))
    await screen.findByText("BK-pi-3")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(calls.at(-1)).toMatchObject({ firstResult: 2 })
  })
})

// A pending or failed filter shows the PREVIOUS result, so count, filters, hand-off and context
// must all be that result's (#341 review).
describe("the instance list states what is ON SCREEN while a filter is pending or failed", () => {
  const ALL = { ...instances(["pi-1", "pi-2"], 120), processDefinitionKey: null }

  function heldSuspendedFeed() {
    const held: Array<{ args: Record<string, unknown>; settle: Promise<ProcessInstancesData> }> = []
    const control: Array<{
      resolve: (value: ProcessInstancesData) => void
      reject: (err: Error) => void
    }> = []
    const feed = (args: Record<string, unknown>) => {
      if (!args.suspended) return Promise.resolve(ALL)
      const settle = new Promise<ProcessInstancesData>((resolve, reject) => {
        control.push({ resolve, reject })
      })
      held.push({ args, settle })
      return settle
    }
    return { held, control, feed }
  }

  async function engineWideList() {
    const { held, control, feed } = heldSuspendedFeed()
    const modelContexts: string[] = []
    const actions: HostAction[] = []
    const Widget = () => <ProcessInstancesWidget data={null} engine="prod-a" />
    render(
      <TestViewHost
        tools={{
          [ENGINE_PROCESS_INSTANCES_DATA]: feed,
          [ENGINE_WIDGET_ACTIONS_DATA]: await widgetActionsFeedFor("read-only"),
        }}
        onModelContext={(text) => modelContexts.push(text)}
        onHostAction={(action) => actions.push(action)}
        client={queryClient}
      >
        <Widget />
      </TestViewHost>,
    )
    await screen.findByText("BK-pi-1")
    await waitFor(() => expect(modelContexts.at(-1)).toContain("matchingInstances=120"))
    const triage = () => {
      fireEvent.click(screen.getByRole("button", { name: /Assess in chat/ }))
      const prompts = actions.flatMap((a) => (a.type === "sendFollowUp" ? [a.prompt] : []))
      return prompts.at(-1)!
    }
    return { held, control, modelContexts, triage }
  }

  it("a pending chip: the previous count with the previous filters, said to be previous", async () => {
    const { held, control, modelContexts, triage } = await engineWideList()

    fireEvent.click(screen.getByRole("button", { name: /^Suspended \d/ }))
    await waitFor(() => expect(held).toHaveLength(1))
    expect(held[0].args).toMatchObject({ suspended: true })

    // The rows on screen are the unfiltered 120; so is everything said about them.
    await waitFor(() => expect(modelContexts.at(-1)).toContain("PREVIOUS result"))
    const context = modelContexts.at(-1)!
    expect(context.split("\n")).toContain("On screen: loaded=2, matchingInstances=120")
    expect(context).not.toContain("suspended=true")
    expect(screen.getByText("120 running")).toBeTruthy()
    const prompt = triage()
    expect(prompt.split("\n")).toContain("On screen: matchingInstances=120")
    expect(prompt).not.toContain("suspended=true")

    control[0].resolve({
      ...instances(["pi-9"], 7),
      processDefinitionKey: null,
      filters: { suspended: true },
    })
    await waitFor(() => expect(screen.queryByText("BK-pi-1")).toBeNull())
    await waitFor(() =>
      expect(modelContexts.at(-1)).toContain(
        "On screen: loaded=1, matchingInstances=7, suspended=true\n",
      ),
    )
    expect(modelContexts.at(-1)).not.toContain("PREVIOUS result")
    expect(screen.getByText("7 running")).toBeTruthy()
    expect(triage().split("\n")).toContain("On screen: matchingInstances=7, suspended=true")
  })

  it("a failed chip keeps saying so, to the operator and to the model", async () => {
    const { held, control, modelContexts, triage } = await engineWideList()

    fireEvent.click(screen.getByRole("button", { name: /^Suspended \d/ }))
    await waitFor(() => expect(held).toHaveLength(1))
    control[0].reject(new Error("engine timeout"))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Couldn't update the list")
    expect(alert.textContent).toContain("You're seeing the previous result.")
    expect(alert.querySelector("details pre")?.textContent).toBe("engine timeout")
    const context = modelContexts.at(-1)!
    expect(context).toContain("PREVIOUS result")
    expect(context).toContain("matchingInstances=120")
    expect(context).not.toContain("suspended=true")
    expect(triage()).not.toContain("suspended=true")
  })

  it("a pending search over an empty list does not claim 'no match' before it answered", async () => {
    const EMPTY = { ...instances([], 0), processDefinitionKey: null }
    const held = deferredFeed<ProcessInstancesData>()
    const feed = (args: Record<string, unknown>) =>
      args.search ? held.handler(args) : Promise.resolve(EMPTY)
    const Widget = () => <ProcessInstancesWidget data={null} engine="prod-a" />
    host(Widget, { [ENGINE_PROCESS_INSTANCES_DATA]: feed })
    await screen.findByText("No running instances for this process definition.")

    fireEvent.change(screen.getByRole("searchbox", { name: "Search by business key or ID" }), {
      target: { value: "ORD" },
    })
    await waitFor(() => expect(held.calls).toHaveLength(1), { timeout: 2_000 })
    expect(screen.getByText("No running instances for this process definition.")).toBeTruthy()
    expect(screen.queryByText("No instances match the filter.")).toBeNull()

    held.calls[0].resolve({ ...EMPTY, filters: { search: "ORD" } })
    await screen.findByText("No instances match the filter.")
    // What the box finds, so an id fragment or a lower-case key is no riddle.
    expect(
      screen.getByText(
        "The search finds part of a business key or the whole ID. Check upper and lower case.",
      ),
    ).toBeTruthy()
  })

  it("a chip without matches says no match, without the search's hint", async () => {
    const EMPTY = { ...instances([], 0), processDefinitionKey: null }
    const feed = (args: Record<string, unknown>) =>
      Promise.resolve(
        args.suspended ? { ...EMPTY, filters: { suspended: true } } : instances(["pi-1"], 1),
      )
    const Widget = () => <ProcessInstancesWidget data={null} engine="prod-a" />
    host(Widget, { [ENGINE_PROCESS_INSTANCES_DATA]: feed })
    await screen.findByText("BK-pi-1")

    fireEvent.click(screen.getByRole("button", { name: /^Suspended \d/ }))

    await screen.findByText("No instances match the filter.")
    expect(screen.queryByText(/The search finds/)).toBeNull()
  })
})

describe("a failed first load says what happened, why, and what you can do", () => {
  const engineDown = () => {
    throw new Error("engine prod-a unreachable (ECONNREFUSED)")
  }
  const odd = () => {
    throw new Error("something odd")
  }

  it.each([
    [
      "process instances",
      () => <ProcessInstancesWidget data={null} engine="prod-a" />,
      ENGINE_PROCESS_INSTANCES_DATA,
      "Could not load the process instances",
    ],
  ])("%s", async (_name, Widget, feed, title) => {
    // A known failure in the kit's words (U1); the raw text under Details; Retry.
    host(Widget, { [feed]: engineDown })
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe(
      "Engine prod-a is unreachable" +
        "Check that the engine is running, or pick another engine." +
        "Details" +
        "engine prod-a unreachable (ECONNREFUSED)" +
        "Try again",
    )
    cleanup()
    // One the kit cannot classify keeps the list's own title.
    host(Widget, { [feed]: odd })
    expect(await screen.findByRole("heading", { name: title })).toBeTruthy()
  })
})
