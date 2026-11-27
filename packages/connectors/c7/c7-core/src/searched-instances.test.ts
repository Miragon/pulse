import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  countSearchedInstances,
  type InstanceBodyReads,
  type InstanceOrQuery,
  type InstanceSearchBody,
  type InstanceWindow,
  pageSearchedInstances,
  searchedInstances,
} from "./searched-instances.js"

/** An instance of the model engine. */
interface Instance {
  readonly id: string
  readonly businessKey: string | null
  readonly incident: boolean
  readonly suspended: boolean
}

/** The engine's LIKE: `%` any run, `_` any one character, the rest as is. */
function like(pattern: string, value: string | null): boolean {
  if (value === null) return false
  const source = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("%", ".*")
    .replaceAll("_", ".")
  return new RegExp(`^${source}$`, "s").test(value)
}

/** Whether the search's OR query finds `instance`: no query finds every one. */
function orFinds(or: InstanceOrQuery | undefined, instance: Instance): boolean {
  if (or === undefined) return true
  return (
    like(or.businessKeyLike, instance.businessKey) || or.processInstanceIds.includes(instance.id)
  )
}

/**
 * Whether the engine finds `instance` by `body`, as it reads one: beside an OR query its join of
 * the open incidents is a left join, so `withIncident` filters nothing there (#717).
 */
function found(instance: Instance, body: InstanceSearchBody): boolean {
  const [or] = body.orQueries ?? []
  const joinsIncidents = body.withIncident === true && or === undefined
  const checks = [
    !joinsIncidents || instance.incident,
    !body.suspended || instance.suspended,
    !body.active || !instance.suspended,
    body.businessKeyLike === undefined || like(body.businessKeyLike, instance.businessKey),
    body.processInstanceIds?.includes(instance.id) ?? true,
    orFinds(or, instance),
  ]
  return checks.every(Boolean)
}

/**
 * An order a database could sort by and no comparison of ours repeats: business keys
 * case-insensitively with the keyless last, the id breaking ties.
 */
function engineOrder(left: Instance, right: Instance): number {
  const key = (instance: Instance) => instance.businessKey?.toLowerCase() ?? "\u{10FFFF}"
  const [a, b] = [key(left), key(right)]
  if (a !== b) return a < b ? -1 : 1
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

/** The model engine's reads, each body it was sent recorded. */
function modelEngine(instances: readonly Instance[]) {
  const bodies: InstanceSearchBody[] = []
  const matching = (body: InstanceSearchBody) => {
    bodies.push(body)
    return instances.filter((instance) => found(instance, body)).sort(engineOrder)
  }
  const reads: InstanceBodyReads<Instance> = {
    count: (body) => Promise.resolve(matching(body).length),
    list: (body, window) =>
      Promise.resolve(
        matching(body).slice(window.firstResult, window.firstResult + window.maxResults),
      ),
  }
  return { reads, bodies }
}

const instance = (id: string, businessKey: string | null, incident = false): Instance => ({
  id,
  businessKey,
  incident,
  suspended: false,
})

describe("searchedInstances: the bodies a search goes out as", () => {
  it("is the filters' one body without a term, their business key pattern kept", () => {
    const filters = {
      processDefinitionKey: "order",
      withIncident: true,
      businessKeyLike: "%A%",
    } as const
    expect(searchedInstances(filters, undefined)).toStrictEqual({ body: filters })
    expect(searchedInstances(filters, "  \n")).toStrictEqual({ body: filters })
  })

  it("ORs the trimmed term as a business key substring with the term as an id, replacing the pattern", () => {
    const searched = searchedInstances(
      { processDefinitionKey: "order", suspended: true, businessKeyLike: "%A%" },
      "  73059b49-c64b-11f1 \n",
    )
    expect(searched).toEqual({
      term: "73059b49-c64b-11f1",
      body: {
        processDefinitionKey: "order",
        suspended: true,
        orQueries: [
          { businessKeyLike: "%73059b49-c64b-11f1%", processInstanceIds: ["73059b49-c64b-11f1"] },
        ],
      },
    })
  })

  it("keeps a wildcard the term places in its business key half", () => {
    const searched = searchedInstances({}, "ORD-%-2026")
    expect(searched).toMatchObject({ body: { orQueries: [{ businessKeyLike: "ORD-%-2026" }] } })
  })

  it("splits the search into top-level halves beside withIncident, which an OR query drops", () => {
    const scope = { processDefinitionKey: "order", active: true, withIncident: true } as const
    const searched = searchedInstances({ ...scope, businessKeyLike: "%A%" }, " CUST ")
    expect(searched).toEqual({
      term: "CUST",
      byKey: { ...scope, businessKeyLike: "%CUST%" },
      byId: { ...scope, processInstanceIds: ["CUST"] },
      overlap: { ...scope, businessKeyLike: "%CUST%", processInstanceIds: ["CUST"] },
    })
  })
})

describe("countSearchedInstances", () => {
  it("counts the one body once", async () => {
    const { reads, bodies } = modelEngine([instance("p1", "CUST-1"), instance("p2", "OTHER")])
    expect(await countSearchedInstances(reads, searchedInstances({}, "CUST"))).toBe(1)
    expect(bodies).toHaveLength(1)
  })

  it("counts the halves less their overlap: an instance whose business key holds its own id once", async () => {
    const { reads, bodies } = modelEngine([
      instance("p1", "of-p1", true),
      instance("p2", "of-p1", true),
      instance("p3", "of-p1"),
    ])
    expect(
      await countSearchedInstances(reads, searchedInstances({ withIncident: true }, "p1")),
    ).toBe(2)
    expect(bodies).toHaveLength(3)
  })

  it("is 0, never below, when an incident opens between the counts and the overlap alone counts it", async () => {
    // The halves read before the incident opened, the overlap after.
    const isOverlap = (body: InstanceSearchBody) =>
      body.businessKeyLike !== undefined && body.processInstanceIds !== undefined
    const reads: InstanceBodyReads<unknown> = {
      count: (body) => Promise.resolve(isOverlap(body) ? 1 : 0),
      list: () => Promise.resolve([]),
    }
    const searched = searchedInstances({ withIncident: true }, "p1")
    expect(await countSearchedInstances(reads, searched)).toBe(0)
  })
})

describe("pageSearchedInstances", () => {
  const BY_ID = { withIncident: true } as const
  // b1 is the id half's instance: its key sorts between a1/a2 and a3.
  const WORLD = [
    instance("a1", "K-b1-1", true),
    instance("a2", "K-b1-2", true),
    instance("a3", "Z-b1-3", true),
    instance("b1", "M", true),
    instance("c1", "K-b1-0"),
  ]
  const page = async (window: InstanceWindow, world: readonly Instance[] = WORLD) => {
    const engine = modelEngine(world)
    const rows = await pageSearchedInstances(engine.reads, searchedInstances(BY_ID, "b1"), window)
    return { ids: rows.map((row) => row.id), bodies: engine.bodies }
  }

  it("lists the one body's window as the engine answers it", async () => {
    const { reads, bodies } = modelEngine(WORLD)
    const rows = await pageSearchedInstances(reads, searchedInstances({}, "b1"), {
      firstResult: 2,
      maxResults: 2,
    })
    expect(rows.map((row) => row.id)).toEqual(["a2", "b1"])
    expect(bodies).toHaveLength(1)
  })

  it.each([
    [{ firstResult: 0, maxResults: 2 }, ["a1", "a2"]],
    [{ firstResult: 0, maxResults: 3 }, ["a1", "a2", "b1"]],
    [{ firstResult: 1, maxResults: 2 }, ["a2", "b1"]],
    [{ firstResult: 2, maxResults: 1 }, ["b1"]],
    [{ firstResult: 3, maxResults: 5 }, ["a3"]],
    [{ firstResult: 4, maxResults: 5 }, []],
  ])("places the id half's instance where the engine sorts it: %o", async (window, expected) => {
    expect((await page(window)).ids).toEqual(expected)
  })

  it("asks the engine to order the rows read and the id half's instance, by their ids alone", async () => {
    const { bodies } = await page({ firstResult: 1, maxResults: 2 })
    expect(bodies.at(-1)).toStrictEqual({ processInstanceIds: ["a1", "a2", "a3", "b1"] })
  })

  it("lists the business key half alone when the id names no instance with the flags", async () => {
    const world = WORLD.map((row) => (row.id === "b1" ? { ...row, incident: false } : row))
    const { ids, bodies } = await page({ firstResult: 1, maxResults: 2 }, world)
    expect(ids).toEqual(["a2", "a3"])
    expect(bodies).toHaveLength(3)
  })

  it("lists the business key half alone when it holds the id half's instance", async () => {
    const world = WORLD.map((row) => (row.id === "b1" ? { ...row, businessKey: "K-b1-15" } : row))
    const { ids, bodies } = await page({ firstResult: 0, maxResults: 5 }, world)
    expect(ids).toEqual(["a1", "b1", "a2", "a3"])
    expect(bodies).toHaveLength(3)
  })

  it("joins no instance the business key half holds before the rows read: the overlap counts it", async () => {
    // b1's own business key holds its id and sorts first, so the window's rows from a1 on miss it.
    const world = [
      instance("b1", "A-b1", true),
      instance("a1", "K-b1-1", true),
      instance("a2", "K-b1-2", true),
    ]
    const { ids, bodies } = await page({ firstResult: 2, maxResults: 1 }, world)
    expect(ids).toEqual(["a2"])
    expect(bodies).toHaveLength(3)
  })

  it("never asks again for an instance the rows read already hold", async () => {
    const rows = [instance("b1", "M", true)]
    const reads: InstanceBodyReads<Instance> = {
      count: () => Promise.resolve(0),
      list: () => Promise.resolve(rows),
    }
    const listed = await pageSearchedInstances(reads, searchedInstances(BY_ID, "b1"), {
      firstResult: 0,
      maxResults: 5,
    })
    expect(listed).toEqual(rows)
  })

  it("orders no row without an id: the id half's row joins nothing, a business key row is left out", async () => {
    const lists: InstanceSearchBody[] = []
    const reads = (named: { id?: string | null }): InstanceBodyReads<{ id?: string | null }> => ({
      count: () => Promise.resolve(0),
      list: (body) => {
        lists.push(body)
        if (body.businessKeyLike !== undefined) return Promise.resolve([{ id: "a1" }, { id: null }])
        const ordered = [{ id: "a1" }, { id: "b1" }]
        return Promise.resolve(body.processInstanceIds?.length === 1 ? [named] : ordered)
      },
    })
    const window = { firstResult: 0, maxResults: 5 }
    const searched = searchedInstances(BY_ID, "b1")
    const unnamed = await pageSearchedInstances(reads({ id: null }), searched, window)
    expect(unnamed).toEqual([{ id: "a1" }, { id: null }])
    const joined = await pageSearchedInstances(reads({ id: "b1" }), searched, window)
    expect(lists.at(-1)).toStrictEqual({ processInstanceIds: ["a1", "b1"] })
    expect(joined).toEqual([{ id: "a1" }, { id: "b1" }])
  })
})

const TERMS = ["i1", "i3", "K", "k-i", "Z", "i"]

const world = fc
  .array(
    fc.record({
      key: fc.option(fc.constantFrom("K", "k-i1", "K-i3", "Z", "zi1", "M", "i3"), { nil: null }),
      incident: fc.boolean(),
      suspended: fc.boolean(),
    }),
    { maxLength: 8 },
  )
  .map((rows) =>
    rows.map((row, at) => ({
      id: `i${at}`,
      businessKey: row.key,
      incident: row.incident,
      suspended: row.suspended,
    })),
  )

const searches = fc.record({
  instances: world,
  term: fc.constantFrom(...TERMS),
  withIncident: fc.boolean(),
  suspended: fc.boolean(),
  window: fc.record({
    firstResult: fc.integer({ min: 0, max: 10 }),
    maxResults: fc.integer({ min: 1, max: 10 }),
  }),
})

/**
 * Searches by the id i0, whose own business key holds it and sorts first (`A-i0`) while every other
 * key holds it after: the id half inside the business key half, which a window from its third row
 * on reads past. The worlds above reach that rarely.
 */
const ownIdSearches = fc.record({
  instances: world.map((rows) =>
    rows.map((row) =>
      row.id === "i0"
        ? { ...row, businessKey: "A-i0", incident: true }
        : { ...row, businessKey: `K-i0-${row.id}` },
    ),
  ),
  term: fc.constant("i0"),
  withIncident: fc.constant(true),
  suspended: fc.boolean(),
  window: fc.record({
    firstResult: fc.integer({ min: 0, max: 8 }),
    maxResults: fc.integer({ min: 1, max: 4 }),
  }),
})

describe("a search with every flag on the model engine (property)", () => {
  it("counts and pages exactly the instances the term and the flags find, never an OR body beside withIncident", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(searches, ownIdSearches),
        async ({ instances, term, withIncident, suspended, window }) => {
          const filters = {
            withIncident: withIncident ? (true as const) : undefined,
            suspended: suspended ? (true as const) : undefined,
          }
          const expected = instances
            .filter((row) => !withIncident || row.incident)
            .filter((row) => !suspended || row.suspended)
            .filter((row) => !!row.businessKey?.includes(term) || row.id === term)
            .sort(engineOrder)
          const { reads, bodies } = modelEngine(instances)
          const searched = searchedInstances(filters, term)
          expect(await countSearchedInstances(reads, searched)).toBe(expected.length)
          const rows = await pageSearchedInstances(reads, searched, window)
          const { firstResult, maxResults } = window
          expect(rows.map((row) => row.id)).toEqual(
            expected.slice(firstResult, firstResult + maxResults).map((row) => row.id),
          )
          expect(bodies.filter((body) => body.withIncident && body.orQueries)).toEqual([])
        },
      ),
    )
  })
})
