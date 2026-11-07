import { afterEach, describe, expect, test, vi } from "vitest"
import { Prompts } from "../src/worker/prompts.js"

afterEach(() => {
  vi.useRealTimers()
})

describe("prompts waiting in the Pulse panel", () => {
  test("report how many wait and settle with the answer", async () => {
    const counts: number[] = []
    const prompts = new Prompts((count) => counts.push(count))
    const asking = prompts.ask({ kind: "pick", title: "Which instance?", choices: [] })
    const [prompt] = prompts.list()

    expect(prompts.answer(prompt?.id ?? "", { kind: "pick", key: "a" })).toBe(true)
    expect(await asking).toEqual({ kind: "pick", key: "a" })
    expect(counts).toEqual([1, 0])
  })

  test("refuse an answer of another kind or for an unknown prompt", () => {
    const prompts = new Prompts(() => undefined)
    void prompts.ask({ kind: "pick", title: "Which instance?", choices: [] })
    const [prompt] = prompts.list()

    expect(prompts.answer(prompt?.id ?? "", { kind: "confirm", confirmed: true })).toBe(false)
    expect(prompts.answer("unknown", { kind: "pick" })).toBe(false)
    expect(prompts.list()).toHaveLength(1)
  })

  test("give up after ten minutes without an answer", async () => {
    vi.useFakeTimers()
    const prompts = new Prompts(() => undefined)
    const asking = prompts.ask({
      kind: "confirm",
      title: "Retry?",
      facts: [],
      confirmLabel: "Retry",
    })

    vi.advanceTimersByTime(10 * 60_000)

    expect(await asking).toBeUndefined()
    expect(prompts.list()).toEqual([])
  })
})
