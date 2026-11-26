// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { focusManager } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createTestQueryClient, TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import type { FindScreenData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { SearchScreen } from "../src/screens/search/search-screen.js"
import { FIND_FEED, searchOf } from "../src/screens/search/search-reads.js"

/**
 * The search across engines while the query client retries an engine that failed, as the page's
 * client does (three retries, its backoff 1, 2, 4 s): the engine says so from its first failed
 * attempt on, as on the start page, and has settled for what the search shows; an answer of a later
 * attempt replaces the failure, and the one hit is decided only once no engine retries. Beside it
 * an engine's search from its read (`searchOf`).
 */

afterEach(() => {
  cleanup()
  // The page's own visibility again, as before a test that hid it.
  focusManager.setFocused(undefined)
})

/** The kit world's find screen under `engine`'s name: its one hit, or none. */
const foundOn = (engine: string, hits = WORLD_SCREENS.find.hits): FindScreenData => ({
  ...WORLD_SCREENS.find,
  engine,
  hits,
})

/** An engine's failure a retry may change, as the feed's result says it. */
const unreachable = (engine: string) => ({
  isError: true,
  content: [{ type: "text", text: `[unreachable] connection to engine ${engine} failed` }],
})

/**
 * Renders the search for ORD-1003 on `engines`, its query client retrying a failed read once and
 * at once; `attempts` answers each engine's attempts in turn, the last one every further attempt.
 */
function renderRetried(engines: readonly string[], attempts: Record<string, readonly unknown[]>) {
  const client = createTestQueryClient()
  client.setDefaultOptions({
    queries: { ...client.getDefaultOptions().queries, retry: 1, retryDelay: 0 },
  })
  const made = new Map<string, number>()
  const find = ({ engine }: { engine: string }) => {
    const answers = attempts[engine] ?? []
    const index = made.get(engine) ?? 0
    made.set(engine, index + 1)
    return answers[Math.min(index, answers.length - 1)]
  }
  const replace = vi.fn<(url: string) => void>()
  const markSeen = vi.fn()
  render(
    <TestViewHost
      tools={{ engine_list_engines: { engines: engines.map((id) => ({ id })) }, [FIND_FEED]: find }}
      client={client}
      locale="en"
      host={{ timeZone: "UTC" }}
      writes={false}
      followUp="none"
      startPage="/app"
    >
      <SearchScreen
        text="ORD-1003"
        navigate={vi.fn()}
        replace={replace}
        entry={{ seen: () => false, markSeen }}
      />
    </TestViewHost>,
  )
  return { made, replace, markSeen }
}

/** A promise the test settles, and its settle. */
function held<T>() {
  let settle!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

const rows = () =>
  screen.queryByRole("table", { name: "Found instances" })?.querySelectorAll("tbody > tr") ?? []

describe("an engine the search retries", () => {
  it("says its failure from the first failed attempt on, and shows its hits once a retry answers", async () => {
    const retry = held<unknown>()
    const { made } = renderRetried(["prod-a", "prod-b"], {
      "prod-a": [foundOn("prod-a", [])],
      "prod-b": [unreachable("prod-b"), retry.promise],
    })

    expect(await screen.findByText("prod-b couldn't be searched")).toBeTruthy()
    expect(made.get("prod-b")).toBe(2)
    // prod-a found nothing, and the search speaks of the engines that could be searched alone.
    expect(
      await screen.findByText(/^No engine that could be searched has an instance/),
    ).toBeTruthy()
    await act(async () => retry.settle(foundOn("prod-b")))
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(screen.queryByText("prod-b couldn't be searched")).toBeNull()
  })

  it("says at once that no engine could be searched where the only one is down, deciding for its entry once its retry failed", async () => {
    const retry = held<unknown>()
    const { replace, markSeen } = renderRetried(["prod-a"], {
      "prod-a": [unreachable("prod-a"), retry.promise],
    })

    expect(
      await screen.findByRole("heading", { level: 2, name: "No engine could be searched" }),
    ).toBeTruthy()
    expect(screen.getByText("prod-a couldn't be searched")).toBeTruthy()
    expect(markSeen).not.toHaveBeenCalled()
    await act(async () => retry.settle(unreachable("prod-a")))
    await waitFor(() => expect(markSeen).toHaveBeenCalledOnce())
    expect(replace).not.toHaveBeenCalled()
  })

  it("opens another engine's one hit where a failed engine's retry answers with none", async () => {
    const retry = held<unknown>()
    const { made, replace } = renderRetried(["prod-a", "prod-b"], {
      "prod-a": [foundOn("prod-a")],
      "prod-b": [unreachable("prod-b"), retry.promise],
    })

    expect(await screen.findByText("prod-b couldn't be searched")).toBeTruthy()
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(made.get("prod-b")).toBe(2)
    // prod-b may still hold more: its retry decides.
    expect(replace).not.toHaveBeenCalled()
    await act(async () => retry.settle(foundOn("prod-b", [])))
    await waitFor(() => expect(replace).toHaveBeenCalledOnce())
    expect(replace).toHaveBeenCalledWith("/app/engines/prod-a/instances/fake-ORD-1003")
  })

  it("holds the one hit while a failed engine's retry waits for the hidden tab, and opens it once the retry answers with none", async () => {
    // TanStack pauses a retry while the page is hidden and goes on once it shows again.
    focusManager.setFocused(false)
    const { made, replace, markSeen } = renderRetried(["prod-a", "prod-b"], {
      "prod-a": [foundOn("prod-a")],
      "prod-b": [unreachable("prod-b"), foundOn("prod-b", [])],
    })

    expect(await screen.findByText("prod-b couldn't be searched")).toBeTruthy()
    await waitFor(() => expect(rows()).toHaveLength(1))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(made.get("prod-b")).toBe(1)
    expect(markSeen).not.toHaveBeenCalled()
    act(() => focusManager.setFocused(true))
    await waitFor(() => expect(replace).toHaveBeenCalledOnce())
    expect(made.get("prod-b")).toBe(2)
    expect(replace).toHaveBeenCalledWith("/app/engines/prod-a/instances/fake-ORD-1003")
  })
})

describe("an engine's search", () => {
  it("is pending while its read has not started, and holds what its read holds once it has", () => {
    expect(searchOf("prod-a", undefined)).toEqual({
      engine: "prod-a",
      found: undefined,
      error: null,
      pending: true,
      retrying: false,
      fetching: false,
    })
    const found = foundOn("prod-a")
    const read = {
      data: found,
      error: null,
      failureReason: null,
      isPending: false,
      isPaused: false,
    }
    expect(searchOf("prod-a", { ...read, isFetching: true })).toEqual({
      engine: "prod-a",
      found,
      error: null,
      pending: false,
      retrying: false,
      fetching: true,
    })
  })

  it("takes the failure of the last attempt while the read retries, settled but retrying", () => {
    const failure = new Error("[unreachable] connection to engine prod-a failed")
    const retrying = {
      data: undefined,
      error: null,
      isPending: true,
      isFetching: true,
      isPaused: false,
    }
    expect(searchOf("prod-a", { ...retrying, failureReason: failure })).toEqual({
      engine: "prod-a",
      found: undefined,
      error: failure,
      pending: false,
      retrying: true,
      fetching: true,
    })
    expect(searchOf("prod-a", { ...retrying, failureReason: null })).toMatchObject({
      error: null,
      pending: true,
      retrying: false,
    })
    // Its retry waits for the hidden tab: still retrying, though it reads nothing now.
    const paused = { ...retrying, failureReason: failure, isFetching: false, isPaused: true }
    expect(searchOf("prod-a", paused)).toMatchObject({
      error: failure,
      pending: false,
      retrying: true,
      fetching: false,
    })
    // Its last retry failed: the read is over.
    const failed = { ...retrying, error: failure, failureReason: failure, isPending: false }
    expect(searchOf("prod-a", { ...failed, isFetching: false })).toMatchObject({
      error: failure,
      retrying: false,
    })
  })
})
