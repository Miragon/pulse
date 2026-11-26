// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import type { ToolCaller, ToolResult } from "@miragon/pulse-widget-shell/widgets"
import { ACROSS_ENGINES, engineLanes } from "../src/engine-lanes.js"
import { ENGINE_VERDICT_FEED } from "../src/screens/engine/verdict-feed.js"
import { FIND_FEED } from "../src/screens/search/search-reads.js"
import {
  callsOf,
  ENGINE_SCREEN_FEED,
  engineList,
  engineScreen,
  settled,
  start,
  stopPage,
} from "./page.test-support.js"

/**
 * The page's lanes (src/engine-lanes.ts): the reads across engines, the start page's and the
 * search's, one call per engine at a time, so an engine that hangs holds one of the browser's
 * connections and the rows of the others show beside it; any other call goes out at once, so an
 * engine's own screen reads its figures and its verdict side by side.
 */

afterEach(stopPage)

/** A call the fake caller holds until the test answers or fails it. */
interface Held {
  readonly name: string
  readonly args: Record<string, unknown>
  readonly answer: () => void
  readonly fail: (error: Error) => void
}

/** A caller that holds every call it gets, in the order it got them. */
function holdingCaller() {
  const held: Held[] = []
  const callTool = vi.fn<ToolCaller>(
    (name, args) =>
      new Promise<ToolResult>((resolve, reject) => {
        held.push({ name, args, answer: () => resolve({ structuredContent: args }), fail: reject })
      }),
  )
  const sent = () => held.map(({ name, args }) => [name, args.engine])
  return { callTool, held, sent }
}

/** Lets the lanes send what they let through (each waits for the call before it). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("an engine's lane", () => {
  it("sends one read across engines of an engine at a time, the next once it answered, another engine's at once", async () => {
    const { callTool, held, sent } = holdingCaller()
    const lanes = engineLanes(callTool)
    const screenRead = lanes(ENGINE_SCREEN_FEED, { engine: "hung" })
    const findRead = lanes(FIND_FEED, { engine: "hung", text: "ORD-1" })
    void lanes(ENGINE_SCREEN_FEED, { engine: "prod-a" })
    await flush()
    expect(sent()).toEqual([
      [ENGINE_SCREEN_FEED, "hung"],
      [ENGINE_SCREEN_FEED, "prod-a"],
    ])
    held[0]?.answer()
    await expect(screenRead).resolves.toEqual({ structuredContent: { engine: "hung" } })
    await flush()
    expect(sent().at(-1)).toEqual([FIND_FEED, "hung"])
    held[2]?.answer()
    await expect(findRead).resolves.toEqual({
      structuredContent: { engine: "hung", text: "ORD-1" },
    })
  })

  it("sends the next call once the one before failed, which fails alone", async () => {
    const { callTool, held, sent } = holdingCaller()
    const lanes = engineLanes(callTool)
    const failed = lanes(FIND_FEED, { engine: "down", text: "ORD-1" })
    const next = lanes(FIND_FEED, { engine: "down", text: "ORD-2" })
    await flush()
    held[0]?.fail(new Error("[unreachable] connection to engine down failed"))
    await expect(failed).rejects.toThrow("[unreachable]")
    await flush()
    expect(sent()).toHaveLength(2)
    held[1]?.answer()
    await expect(next).resolves.toEqual({ structuredContent: { engine: "down", text: "ORD-2" } })
  })

  it("joins a call that asks what a queued one asks, and reads anew after one already sent", async () => {
    const { callTool, held, sent } = holdingCaller()
    const lanes = engineLanes(callTool)
    void lanes(ENGINE_SCREEN_FEED, { engine: "hung" })
    await flush()
    // The engine hangs on its first read: a second and a third ask the same behind it.
    const second = lanes(ENGINE_SCREEN_FEED, { engine: "hung" })
    const third = lanes(ENGINE_SCREEN_FEED, { engine: "hung" })
    expect(third).toBe(second)
    held[0]?.answer()
    await flush()
    expect(sent()).toHaveLength(2)
    held[1]?.answer()
    await expect(third).resolves.toEqual({ structuredContent: { engine: "hung" } })
    expect(callTool).toHaveBeenCalledTimes(2)
  })

  it("sends at once a verdict, a read of one engine's screen, a call that names no engine and one past the lanes", async () => {
    const { callTool, sent } = holdingCaller()
    const lanes = engineLanes(callTool)
    void lanes(ENGINE_SCREEN_FEED, { engine: "hung" })
    void lanes(ENGINE_VERDICT_FEED, { engine: "hung" })
    void lanes("engine_screen_process_data", { engine: "hung", processKey: "pulse-order" })
    void lanes("engine_list_engines", {})
    void engineLanes(callTool, new Set())(FIND_FEED, { engine: "hung", text: "ORD-1" })
    await flush()
    expect(sent()).toEqual([
      [ENGINE_VERDICT_FEED, "hung"],
      ["engine_screen_process_data", "hung"],
      ["engine_list_engines", undefined],
      [FIND_FEED, "hung"],
      [ENGINE_SCREEN_FEED, "hung"],
    ])
    expect([...ACROSS_ENGINES].sort()).toEqual([FIND_FEED, ENGINE_SCREEN_FEED])
  })
})

/** Two Camunda 7 engines, the first of which hangs. */
const LIST = {
  engines: [
    { id: "hung", environment: "prod", dialect: "c7" },
    { id: "prod-a", environment: "prod", dialect: "c7" },
  ],
}

/** A tool's answer as the page's API gives it. */
const answer = (structuredContent: unknown) =>
  Response.json({ result: { content: [{ type: "text", text: "{}" }], structuredContent } })

/** What a call of the start page or the search answers, `engine` the engine it reads. */
function answerOf(name: string, engine: string): Response {
  if (name === "engine_list_engines") return Response.json(engineList(LIST))
  if (name === ENGINE_SCREEN_FEED) return Response.json(engineScreen(engine))
  if (name === ENGINE_VERDICT_FEED) return answer({ status: "ok" })
  return answer({ ...WORLD_SCREENS.find, engine })
}

/**
 * The server, its engine `hung` answering only when the test releases it: each engine's calls
 * under way, and the most of them at once.
 */
function hangingServer() {
  const underWay = new Map<string, number>()
  const most = new Map<string, number>()
  const releases: Array<() => void> = []
  const count = (engine: string, by: number) => {
    underWay.set(engine, (underWay.get(engine) ?? 0) + by)
    most.set(engine, Math.max(most.get(engine) ?? 0, underWay.get(engine) ?? 0))
  }
  const call = async ({
    name,
    arguments: args,
  }: {
    name: string
    arguments?: Record<string, unknown>
  }) => {
    const engine = typeof args?.engine === "string" ? args.engine : ""
    count(engine, 1)
    if (engine === "hung") await new Promise<void>((release) => releases.push(release))
    count(engine, -1)
    return answerOf(name, engine)
  }
  /** Answers every call of `hung` held so far, once one is held. */
  const release = async () => {
    await waitFor(() => expect(releases.length).toBeGreaterThan(0))
    await act(async () => {
      for (const next of releases.splice(0)) next()
    })
    await settled()
  }
  return { call, most, release }
}

const engineRow = (engine: string) =>
  within(screen.getByRole("table", { name: "Engines" })).getByRole("row", {
    name: `Engine ${engine}`,
  })

describe("the reads across engines on the page", () => {
  it("reads an engine that hangs one call at a time on the start page, the other engine's row and state beside it", async () => {
    const server = hangingServer()
    const { fetch } = await start("/app", server)
    await waitFor(() => expect(engineRow("prod-a").textContent).toContain("Stable"))
    expect(callsOf(fetch, ENGINE_SCREEN_FEED)).toEqual([{ engine: "hung" }, { engine: "prod-a" }])
    // The hanging engine's verdict waits for its screen's answer, never beside its read.
    expect(callsOf(fetch, ENGINE_VERDICT_FEED)).toEqual([{ engine: "prod-a" }])
    await server.release()
    await waitFor(() =>
      expect(callsOf(fetch, ENGINE_VERDICT_FEED)).toEqual([
        { engine: "prod-a" },
        { engine: "hung" },
      ]),
    )
    await server.release()
    await waitFor(() => expect(engineRow("hung").textContent).toContain("Stable"))
    expect(Object.fromEntries(server.most)).toMatchObject({ hung: 1, "prod-a": 1 })
  })

  it("searches an engine whose read of the start page still hangs once that read settled, the others at once", async () => {
    const server = hangingServer()
    const { fetch } = await start("/app", server)
    await waitFor(() => expect(engineRow("prod-a").textContent).toContain("Stable"))
    const side = document.querySelector<HTMLElement>("[data-slot=page-side]")!
    const field = within(side).getByRole("searchbox", { name: "Find an instance" })
    fireEvent.change(field, { target: { value: "ORD-1003" } })
    await act(async () => fireEvent.submit(within(side).getByRole("search")))
    await settled()
    await waitFor(() =>
      expect(callsOf(fetch, FIND_FEED)).toContainEqual({ engine: "prod-a", text: "ORD-1003" }),
    )
    expect(callsOf(fetch, FIND_FEED)).toEqual([{ engine: "prod-a", text: "ORD-1003" }])
    // The start page's read of the hanging engine goes first; the page it left reads no verdict.
    await server.release()
    await waitFor(() =>
      expect(callsOf(fetch, FIND_FEED)).toEqual([
        { engine: "prod-a", text: "ORD-1003" },
        { engine: "hung", text: "ORD-1003" },
      ]),
    )
    await server.release()
    expect(Object.fromEntries(server.most)).toMatchObject({ hung: 1, "prod-a": 1 })
    // Nothing of the start page it left went out behind the search: no verdict of the hanging engine.
    expect(callsOf(fetch, ENGINE_VERDICT_FEED)).toEqual([{ engine: "prod-a" }])
  })

  it("reads an engine's own screen's figures and its verdict side by side on its Refresh", async () => {
    const releases: Array<() => void> = []
    let screens = 0
    const { fetch } = await start("/app/engines/prod-a", {
      call: async ({ name, arguments: args }) => {
        const engine = typeof args?.engine === "string" ? args.engine : ""
        // The engine answers its first read of the figures and holds every later one.
        if (name === ENGINE_SCREEN_FEED && screens++ > 0) {
          await new Promise<void>((release) => releases.push(release))
        }
        return answerOf(name, engine)
      },
    })
    await waitFor(() => expect(callsOf(fetch, ENGINE_VERDICT_FEED)).toHaveLength(1))
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })))
    await waitFor(() => expect(callsOf(fetch, ENGINE_SCREEN_FEED)).toHaveLength(2))
    // The figures' read hangs: the verdict is read beside it, never after it.
    await waitFor(() => expect(callsOf(fetch, ENGINE_VERDICT_FEED)).toHaveLength(2))
    await act(async () => {
      for (const release of releases.splice(0)) release()
    })
  })
})
