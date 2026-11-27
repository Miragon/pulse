import { describe, expect, it } from "vitest"
import { turningTies, turnTies } from "./fake-port.js"

/** Rows written `<key><id>`, keyed by their first character. */
const ROWS = ["3a", "3b", "3c", "2d", "1e", "1f"]
const keyOf = (row: string) => row.charAt(0)

const query = (firstResult?: number, maxResults?: number) => ({
  pathArgs: [],
  query: {
    firstResult: firstResult === undefined ? undefined : String(firstResult),
    maxResults: maxResults === undefined ? undefined : String(maxResults),
  },
})

describe("turnTies", () => {
  it("turns every run of rows with the same key, and none across keys", () => {
    expect(turnTies(ROWS, keyOf, 0)).toStrictEqual(ROWS)
    expect(turnTies(ROWS, keyOf, 1)).toStrictEqual(["3b", "3c", "3a", "2d", "1f", "1e"])
    expect(turnTies(ROWS, keyOf, 4)).toStrictEqual(["3b", "3c", "3a", "2d", "1e", "1f"])
  })
})

describe("turningTies", () => {
  it("answers the window asked for, its ties turned one further on every request", () => {
    const route = turningTies(ROWS, keyOf)

    expect(route(query(0, 2))).toStrictEqual(["3a", "3b"])
    expect(route(query(0, 2))).toStrictEqual(["3b", "3c"])
    expect(route(query(2, 4))).toStrictEqual(["3b", "2d", "1e", "1f"])
  })

  it("answers every row to a request without paging", () => {
    expect(turningTies(ROWS, keyOf)(query())).toStrictEqual(ROWS)
  })
})
