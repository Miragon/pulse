import { describe, expect, test } from "vitest"
import { InstanceRows, type InstanceRowData } from "../../src/index.js"

const row = (id: string): InstanceRowData => ({ id, state: "running", hasIncident: false })

describe("the rows of an instance list read page by page", () => {
  test("take a later page after the rows shown, in the order the engine gives them", () => {
    expect(InstanceRows.appended([row("a"), row("b")], [row("c"), row("d")])).toEqual([
      row("a"),
      row("b"),
      row("c"),
      row("d"),
    ])
  })

  test("show an instance once where a later page repeats a row an offset page showed before", () => {
    const shown = [row("new"), row("a"), row("b")]

    expect(InstanceRows.appended(shown, [row("b"), row("c")]).map(({ id }) => id)).toEqual([
      "new",
      "a",
      "b",
      "c",
    ])
  })

  test("keep the rows shown where a later page has none, and take a first page whole", () => {
    expect(InstanceRows.appended([row("a")], [])).toEqual([row("a")])
    expect(InstanceRows.appended([], [row("a")])).toEqual([row("a")])
  })
})
