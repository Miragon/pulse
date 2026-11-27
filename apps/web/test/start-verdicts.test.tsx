// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { focusManager } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createTestQueryClient,
  type HostAction,
  type QueryClient,
  TestViewHost,
} from "@miragon/pulse-widget-shell/widgets"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { ENGINE_SCREEN_FEED } from "../src/screens/engine/engine-feed.js"
import { ENGINE_VERDICT_FEED } from "../src/screens/engine/verdict-feed.js"
import { StartScreen } from "../src/screens/start/start-screen.js"

/**
 * A Camunda 7 engine's verdict on the start page follows its engine's figures: read once their
 * read answered, whatever it says of the engine, and again after each new answer of it (the
 * Refresh, the reader's return, the page shown again), never started while they read (a retry of
 * theirs paused in a hidden tab included), so an engine that hangs holds one connection, and never
 * after a failed read, so the verdict asks the engine for no second statistics (the server's half:
 * verdict-data.test.ts of the engine module); one under way when they are read again counts for
 * their answer.
 */

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  // The page's own visibility again, as before a test that hid it.
  focusManager.setFocused(undefined)
})

/** Two Camunda 7 engines. */
const LIST = {
  engines: [
    { id: "prod-a", dialect: "c7" },
    { id: "prod-b", dialect: "c7" },
  ],
}

/** The engine screen of `engine` as its feed answers: the kit world's under its name. */
const worldOn = (engine: string) => ({ ...WORLD_SCREENS.engine, engine, webApp: null })

/** A failure a retry may change, as the feed's result says it. */
const unreachable = (engine: string) => ({
  isError: true,
  content: [{ type: "text", text: `[unreachable] connection to engine ${engine} failed` }],
})

/** A promise the test settles, and its settle. */
function held() {
  let settle!: (value: unknown) => void
  const promise = new Promise<unknown>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

/**
 * The start page over `figures` and `verdicts`, which answer each read of an engine's figures and
 * of its verdict, its query client `client` (default: one that retries a failed read once and at
 * once); its calls in order.
 */
function renderStart(
  figures: (engine: string) => unknown,
  client: QueryClient = retryingClient(),
  verdicts: (engine: string) => unknown = () => ({ status: "ok" }),
) {
  const actions: HostAction[] = []
  const tools = {
    engine_list_engines: LIST,
    [ENGINE_SCREEN_FEED]: ({ engine }: { engine: string }) => figures(engine),
    [ENGINE_VERDICT_FEED]: ({ engine }: { engine: string }) => verdicts(engine),
  }
  const show = () =>
    render(
      <TestViewHost
        tools={tools}
        client={client}
        onHostAction={(action) => actions.push(action)}
        locale="en"
        host={{ timeZone: "UTC" }}
        writes={false}
        followUp="none"
        startPage="/app"
      >
        <StartScreen navigate={vi.fn()} replace={vi.fn()} />
      </TestViewHost>,
    )
  show()
  const calls = (engine: string) =>
    actions.flatMap((action) =>
      action.type === "callTool" && action.args.engine === engine ? [action.name] : [],
    )
  return { calls, show }
}

/** A query client as the page's, retrying a failed read once and at once. */
function retryingClient(): QueryClient {
  const client = createTestQueryClient()
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: 1, retryDelay: 0 },
  })
  return client
}

const stateOf = (engine: string) =>
  within(screen.getByRole("table", { name: "Engines" }))
    .getByRole("row", { name: `Engine ${engine}` })
    .querySelector<HTMLElement>('[data-part="engine-verdict"]')
    ?.getAttribute("data-state")

/** Lets the page's effects and the fake's answers run. */
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 20)))

describe("a verdict on the start page", () => {
  it("is read once its engine's figures answered, never beside their read, whatever they say of the engine", async () => {
    const slow = held()
    const { calls } = renderStart((engine) =>
      engine === "prod-a" ? slow.promise : { ...worldOn(engine), info: null },
    )
    await waitFor(() => expect(stateOf("prod-b")).toBe("ok"))
    expect(calls("prod-b")).toEqual([ENGINE_SCREEN_FEED, ENGINE_VERDICT_FEED])
    expect(calls("prod-a")).toEqual([ENGINE_SCREEN_FEED])
    await act(async () => slow.settle(worldOn("prod-a")))
    await waitFor(() => expect(stateOf("prod-a")).toBe("ok"))
    await settle()
    expect(calls("prod-a")).toEqual([ENGINE_SCREEN_FEED, ENGINE_VERDICT_FEED])
  })

  it("is never read after a failed read of its engine's figures, retried or refreshed", async () => {
    let answer: unknown = unreachable("prod-a")
    const { calls } = renderStart((engine) => (engine === "prod-a" ? answer : worldOn(engine)))
    expect(await screen.findByText("prod-a couldn't be read")).toBeTruthy()
    await waitFor(() => expect(calls("prod-a")).toEqual([ENGINE_SCREEN_FEED, ENGINE_SCREEN_FEED]))
    await settle()
    expect(calls("prod-a")).not.toContain(ENGINE_VERDICT_FEED)
    // A Refresh that answers reads it after the figures; one that fails over them reads none.
    answer = worldOn("prod-a")
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(stateOf("prod-a")).toBe("ok"))
    answer = unreachable("prod-a")
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    expect(await screen.findByText("prod-a couldn't be read")).toBeTruthy()
    await waitFor(() =>
      expect(calls("prod-a").filter((name) => name === ENGINE_SCREEN_FEED)).toHaveLength(5),
    )
    await settle()
    expect(calls("prod-a").filter((name) => name === ENGINE_VERDICT_FEED)).toHaveLength(1)
  })

  it("is read again after its engine's figures when the page is shown again after 60 s, never beside them", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const again = held()
    const client = retryingClient()
    let reads = 0
    const first = renderStart(
      (engine) => (reads++ < 2 ? worldOn(engine) : again.promise.then(() => worldOn(engine))),
      client,
    )
    await waitFor(() => expect(stateOf("prod-a")).toBe("ok"))
    await waitFor(() => expect(stateOf("prod-b")).toBe("ok"))
    cleanup()
    vi.setSystemTime(Date.now() + 61_000)
    first.show()
    await waitFor(() => expect(first.calls("prod-a")).toHaveLength(3))
    await settle()
    // The figures read again at once; the verdict, cached, waits for their answer.
    expect(first.calls("prod-a")).toEqual([
      ENGINE_SCREEN_FEED,
      ENGINE_VERDICT_FEED,
      ENGINE_SCREEN_FEED,
    ])
    await act(async () => again.settle(undefined))
    await waitFor(() => expect(first.calls("prod-a")).toHaveLength(4))
    expect(first.calls("prod-a").at(-1)).toBe(ENGINE_VERDICT_FEED)
  })

  it("that failed waits for its engine's figures when the page is shown again, its failure shown meanwhile", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const again = held()
    let figures = 0
    let verdicts = 0
    const first = renderStart(
      (engine) => (figures++ < 2 ? worldOn(engine) : again.promise.then(() => worldOn(engine))),
      retryingClient(),
      (engine) => (engine === "prod-a" && verdicts++ < 2 ? unreachable(engine) : { status: "ok" }),
    )
    await waitFor(() => expect(stateOf("prod-a")).toBe("unreachable"))
    expect(first.calls("prod-a")).toEqual([
      ENGINE_SCREEN_FEED,
      ENGINE_VERDICT_FEED,
      ENGINE_VERDICT_FEED,
    ])
    cleanup()
    vi.setSystemTime(Date.now() + 61_000)
    first.show()
    await waitFor(() => expect(first.calls("prod-a")).toHaveLength(4))
    await settle()
    expect(first.calls("prod-a").at(-1)).toBe(ENGINE_SCREEN_FEED)
    expect(stateOf("prod-a")).toBe("unreachable")
    await act(async () => again.settle(undefined))
    await waitFor(() => expect(stateOf("prod-a")).toBe("ok"))
    expect(first.calls("prod-a")).toHaveLength(5)
  })

  it("whose first read is under way when its figures are refreshed shows its answer at once and counts for their answer", async () => {
    const verdict = held()
    const again = held()
    let reads = 0
    const { calls } = renderStart(
      (engine) =>
        engine === "prod-a" && reads++ > 0
          ? again.promise.then(() => worldOn(engine))
          : worldOn(engine),
      retryingClient(),
      (engine) => (engine === "prod-a" ? verdict.promise : { status: "ok" }),
    )
    await waitFor(() => expect(calls("prod-a")).toEqual([ENGINE_SCREEN_FEED, ENGINE_VERDICT_FEED]))
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(calls("prod-a")).toHaveLength(3))
    await settle()
    // The figures' read is held; the verdict's, under way since before the Refresh, answers.
    await act(async () => verdict.settle({ status: "critical" }))
    await waitFor(() => expect(stateOf("prod-a")).toBe("critical"))
    await act(async () => again.settle(undefined))
    await settle()
    expect(calls("prod-a")).toEqual([ENGINE_SCREEN_FEED, ENGINE_VERDICT_FEED, ENGINE_SCREEN_FEED])
    expect(stateOf("prod-a")).toBe("critical")
  })

  it("that failed waits while its engine's figures retry in a hidden tab, and is read once they answered", async () => {
    let figures = 0
    let verdicts = 0
    const { calls } = renderStart(
      (engine) => (engine === "prod-a" && figures++ === 1 ? unreachable(engine) : worldOn(engine)),
      retryingClient(),
      (engine) => (engine === "prod-a" && verdicts++ < 2 ? unreachable(engine) : { status: "ok" }),
    )
    await waitFor(() => expect(stateOf("prod-a")).toBe("unreachable"))
    // TanStack pauses a retry while the page is hidden and goes on once it shows again.
    focusManager.setFocused(false)
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(figures).toBe(2))
    await settle()
    expect(calls("prod-a")).toEqual([
      ENGINE_SCREEN_FEED,
      ENGINE_VERDICT_FEED,
      ENGINE_VERDICT_FEED,
      ENGINE_SCREEN_FEED,
    ])
    act(() => focusManager.setFocused(true))
    await waitFor(() => expect(stateOf("prod-a")).toBe("ok"))
    await settle()
    expect(calls("prod-a").slice(3)).toEqual([
      ENGINE_SCREEN_FEED,
      ENGINE_SCREEN_FEED,
      ENGINE_VERDICT_FEED,
    ])
  })

  it("under way when its figures are refreshed counts for their answer, also where their retry waited for a hidden tab", async () => {
    const verdict = held()
    const again = held()
    let figures = 0
    const { calls } = renderStart(
      (engine) => (engine === "prod-a" && figures++ === 1 ? again.promise : worldOn(engine)),
      retryingClient(),
      (engine) => (engine === "prod-a" ? verdict.promise : { status: "ok" }),
    )
    await waitFor(() => expect(calls("prod-a")).toEqual([ENGINE_SCREEN_FEED, ENGINE_VERDICT_FEED]))
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(calls("prod-a")).toHaveLength(3))
    await settle()
    // The figures' read fails once the tab is hidden, so their retry waits; the verdict answers.
    focusManager.setFocused(false)
    await act(async () => again.settle(unreachable("prod-a")))
    await act(async () => verdict.settle({ status: "critical" }))
    await waitFor(() => expect(stateOf("prod-a")).toBe("critical"))
    await settle()
    act(() => focusManager.setFocused(true))
    await waitFor(() => expect(figures).toBe(3))
    await settle()
    expect(calls("prod-a")).toEqual([
      ENGINE_SCREEN_FEED,
      ENGINE_VERDICT_FEED,
      ENGINE_SCREEN_FEED,
      ENGINE_SCREEN_FEED,
    ])
    expect(stateOf("prod-a")).toBe("critical")
  })

  it("is read again after its engine's figures on the reader's return after 60 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    const again = held()
    let reads = 0
    const { calls } = renderStart((engine) =>
      reads++ < 2 ? worldOn(engine) : again.promise.then(() => worldOn(engine)),
    )
    await waitFor(() => expect(stateOf("prod-a")).toBe("ok"))
    await waitFor(() => expect(stateOf("prod-b")).toBe("ok"))
    vi.setSystemTime(Date.now() + 61_000)
    await act(async () => {
      fireEvent.focus(window)
    })
    await waitFor(() => expect(calls("prod-a")).toHaveLength(3))
    await settle()
    expect(calls("prod-a").at(-1)).toBe(ENGINE_SCREEN_FEED)
    await act(async () => again.settle(undefined))
    await waitFor(() => expect(calls("prod-a")).toHaveLength(4))
    expect(calls("prod-a").at(-1)).toBe(ENGINE_VERDICT_FEED)
  })
})
