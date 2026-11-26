import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { ProcessRuntime } from "@miragon/pulse-engine-core"
import { ENGINE_SCREEN_INSTANCES_DATA } from "../../tool-names.js"
import { SCREEN_FEEDS } from "../screen-feeds.js"
import type { RuntimeEngine } from "../../lib/engine/resolve-engine.js"
import { buildInstanceListData } from "./instance-list-data.js"
import { buildProcessScreenData } from "./process-screen-data.js"
import { buildVariableNamesData } from "./variable-names-data.js"

/**
 * The process screen's feeds over a runtime a test hands in: a process without a version, the
 * condition kinds an engine refuses, a version's variable names and what the instance list's input
 * takes of a condition. The numbers over each
 * dialect's recorded answers are process-screen-data.numbers.test.ts.
 */

const runtime = vi.hoisted(() => ({ current: {} }))

vi.mock("../../lib/engine/engine-runtime.js", () => ({
  runtimeOf: () => runtime.current,
}))

afterEach(() => {
  runtime.current = {}
})

/** An engine of another dialect, its own backend the floor keeps its answers under. */
const engineOf = (engineId: string): RuntimeEngine =>
  ({ engineId, dialect: "c8", backend: {} }) as unknown as RuntimeEngine

describe("the process screen feed", () => {
  it("refuses a process the engine has no version of, by a code no retry changes", async () => {
    runtime.current = { listVersions: vi.fn().mockResolvedValue([]) }

    await expect(buildProcessScreenData(engineOf("c8"), { process: "nope" })).rejects.toMatchObject(
      {
        code: "UNKNOWN_PROCESS",
        message: 'Process "nope" has no version on engine "c8".',
      },
    )
  })
})

describe("the instance list feed", () => {
  const refusing = (): Partial<ProcessRuntime> => ({
    refusedVariableConditions: () => ["ordering", "date"],
    searchInstances: vi.fn(),
    countInstances: vi.fn(),
  })

  it("refuses a condition of a kind the engine refuses before it reads anything", async () => {
    const reads = refusing()
    runtime.current = reads
    const engine = engineOf("c8")
    const request = { definitionId: "d1", scope: "running" } as const

    await expect(
      buildInstanceListData(engine, {
        ...request,
        variables: [{ name: "amount", operator: "greaterThan", value: "100" }],
      }),
    ).rejects.toThrow(
      'can\'t compare a variable by greater or less than, so the condition on "amount"',
    )
    await expect(
      buildInstanceListData(engine, {
        ...request,
        variables: [{ name: "dueAt", operator: "equals", value: "2026-03-15T10:00Z", as: "date" }],
      }),
    ).rejects.toThrow(/by a date/)
    await expect(
      buildInstanceListData(engine, {
        ...request,
        variables: [{ name: "amount", operator: "lessThan", value: "1" }],
      }),
    ).rejects.toMatchObject({ code: "REFUSED_CONDITION" })
    expect(reads.searchInstances).not.toHaveBeenCalled()
    expect(reads.countInstances).not.toHaveBeenCalled()
  })

  it("reads a pattern, an equality and an ordering where the engine refuses none", async () => {
    const searchInstances = vi.fn().mockResolvedValue({ items: [] })
    const countInstances = vi.fn().mockResolvedValue({ count: 0 })
    runtime.current = { searchInstances, countInstances }

    const list = await buildInstanceListData(engineOf("c7"), {
      definitionId: "d1",
      scope: "running",
      element: "Task_A",
      businessKey: "ORD-1",
      variables: [
        { name: "route", operator: "like", value: "rev*" },
        { name: "amount", operator: "lessThan", value: "100" },
        { name: "ok", operator: "equals", value: "true" },
      ],
    })

    expect(list).toMatchObject({
      definitionId: "d1",
      rows: [],
      next: null,
      refusedVariableConditions: [],
    })
    expect(searchInstances).toHaveBeenCalledWith(
      expect.objectContaining({ activeElementId: "Task_A", businessKey: "ORD-1" }),
      { limit: 50 },
    )
  })

  it("reads a later page by its cursor, without the counts", async () => {
    const searchInstances = vi.fn().mockResolvedValue({ items: [] })
    const countInstances = vi.fn()
    runtime.current = { searchInstances, countInstances }

    const list = await buildInstanceListData(engineOf("c7"), {
      definitionId: "d1",
      scope: "all",
      variables: [],
      after: "cursor-1",
    })

    expect(list.counts).toBeNull()
    expect(searchInstances).toHaveBeenCalledWith(expect.anything(), {
      limit: 50,
      after: "cursor-1",
    })
    expect(countInstances).not.toHaveBeenCalled()
  })

  it("keeps a first page for the floor's 30 s, never a later one, whose cursor is its first page's", async () => {
    const searchInstances = vi.fn().mockResolvedValue({ items: [], next: "50" })
    const countInstances = vi.fn().mockResolvedValue({ count: 0 })
    runtime.current = { searchInstances, countInstances }
    const engine = engineOf("c7")
    const first = { definitionId: "d3", scope: "all" } as const

    await buildInstanceListData(engine, first)
    await buildInstanceListData(engine, first)
    expect(searchInstances).toHaveBeenCalledTimes(1)

    await buildInstanceListData(engine, { ...first, after: "50" })
    await buildInstanceListData(engine, { ...first, after: "50" })
    expect(searchInstances).toHaveBeenCalledTimes(3)
  })
})

describe("the variable names feed", () => {
  it("names the variables of a version and the kinds of condition the engine refuses", async () => {
    runtime.current = {
      listVariableNames: vi.fn().mockResolvedValue(["amount", "route"]),
      refusedVariableConditions: () => ["ordering", "date"],
    }

    expect(await buildVariableNamesData(engineOf("c8"), "d1")).toEqual({
      definitionId: "d1",
      names: ["amount", "route"],
      refused: ["ordering", "date"],
    })
  })

  it("refuses no kind on an engine that names none, and keeps the names for the floor's 30 s", async () => {
    const listVariableNames = vi.fn().mockResolvedValue(["total"])
    runtime.current = { listVariableNames }
    const engine = engineOf("c7")

    expect(await buildVariableNamesData(engine, "d2")).toEqual({
      definitionId: "d2",
      names: ["total"],
      refused: [],
    })
    await buildVariableNamesData(engine, "d2")
    expect(listVariableNames).toHaveBeenCalledTimes(1)
  })
})

describe("the instance list feed's input", () => {
  const shape = SCREEN_FEEDS.find(({ name }) => name === ENGINE_SCREEN_INSTANCES_DATA)?.shape ?? {}
  const parse = (variables: unknown) =>
    z.strictObject(shape).safeParse({ definitionId: "d1", scope: "running", variables }).success

  it("takes a value as the type it compares as reads it: a number, a boolean, a date with its offset", () => {
    expect(parse([{ name: "a", operator: "greaterThan", value: "9.5" }])).toBe(true)
    expect(parse([{ name: "a", operator: "equals", value: "true", as: "boolean" }])).toBe(true)
    expect(
      parse([{ name: "a", operator: "lessThan", value: "2026-03-15T10:00+01:00", as: "date" }]),
    ).toBe(true)
    expect(
      parse([{ name: "a", operator: "equals", value: "2026-03-15T10:00:00.123Z", as: "date" }]),
    ).toBe(true)
    expect(parse([{ name: "a", operator: "like", value: "ORD-*", as: "number" }])).toBe(true)
    expect(parse([{ name: "a", operator: "equals", value: "anything", as: "text" }])).toBe(true)
  })

  it("refuses a value the type it compares as cannot read, a date without its offset among them", () => {
    expect(parse([{ name: "a", operator: "greaterThan", value: "much" }])).toBe(false)
    expect(parse([{ name: "a", operator: "equals", value: "yes", as: "boolean" }])).toBe(false)
    expect(parse([{ name: "a", operator: "equals", value: "2026-03-15T10:00", as: "date" }])).toBe(
      false,
    )
  })

  it("refuses a key a condition does not take, and more than five conditions", () => {
    expect(parse([{ name: "a", operator: "equals", value: "1", extra: true }])).toBe(false)
    expect(
      parse(Array.from({ length: 6 }, () => ({ name: "a", operator: "equals", value: "1" }))),
    ).toBe(false)
  })
})
