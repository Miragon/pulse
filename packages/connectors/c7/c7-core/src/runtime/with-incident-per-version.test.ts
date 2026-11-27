import { describe, expect, it } from "vitest"
import type { Query } from "../port.js"
import { fakePort, type FakePort } from "../testing/fake-port.js"
import {
  type RunningVersion,
  type WithIncidentCounting,
  withIncidentPerVersion,
} from "./with-incident-per-version.js"

interface Failing {
  readonly id: string
  readonly definitionId: string
}

const keyOf = (definitionId: string) => definitionId.split(":")[0]

/** `count` instances with an incident, the n-th on the n-th of `versions` round and round. */
function failingOver(count: number, versions: readonly string[]): Failing[] {
  return Array.from({ length: count }, (_, at) => ({
    id: `p${String(at).padStart(4, "0")}`,
    definitionId: versions[at % versions.length] ?? "",
  }))
}

/** Versions `order:<n>:v` running an instance each, and one more that runs none. */
function runningVersions(count: number): RunningVersion[] {
  return [
    ...Array.from({ length: count }, (_, at) => ({
      id: `order:${String(at + 1)}:v`,
      instances: 1,
    })),
    { id: "order:0:idle", instances: 0 },
  ]
}

/**
 * An engine whose instances with an incident are `failing`, listed by id and counted by scope or
 * version, a count answered otherwise where `counts` says so (incidents raised or resolved since).
 */
function engineOver(
  failing: readonly Failing[],
  counts: { readonly scope?: number; readonly byVersion?: Readonly<Record<string, number>> } = {},
): FakePort {
  const inScope = (query: Query) =>
    failing.filter(
      (row) =>
        query.processDefinitionKey === undefined ||
        keyOf(row.definitionId) === query.processDefinitionKey,
    )
  return fakePort({
    getProcessInstances: ({ query }) => {
      const first = Number(query.firstResult)
      return inScope(query).slice(first, first + Number(query.maxResults))
    },
    getProcessInstancesCount: ({ query }) => {
      const id = query.processDefinitionId
      if (id === undefined) return { count: counts.scope ?? inScope(query).length }
      const own = failing.filter((row) => row.definitionId === id).length
      return { count: counts.byVersion?.[id] ?? own }
    },
  })
}

/** What each request asked: a page of the listing from its first row, or a count and of what. */
function requestsOf(port: FakePort): string[] {
  return port.calls.map(({ operationId, input: { query } }) =>
    operationId === "getProcessInstances"
      ? `page from ${query.firstResult ?? "?"}`
      : `count of ${query.processDefinitionId ?? query.processDefinitionKey ?? "the engine"}`,
  )
}

function countsOver(
  port: FakePort,
  versions: readonly RunningVersion[],
  counting: WithIncidentCounting = {},
) {
  return withIncidentPerVersion(port, {}, Promise.resolve(versions), counting)
}

describe("withIncidentPerVersion", () => {
  it("counts per version from one page of the scope's instances with an incident that holds them all", async () => {
    const failing = failingOver(3, ["order:1:v", "order:2:v"])
    const port = engineOver([...failing, { id: "q1", definitionId: "refund:1:r" }])

    const counts = await withIncidentPerVersion(
      port,
      { processDefinitionKey: "order" },
      Promise.resolve(runningVersions(2)),
    )

    expect(counts).toEqual(
      new Map([
        ["order:1:v", 2],
        ["order:2:v", 1],
      ]),
    )
    expect(port.calls.map((call) => call.input.query)).toStrictEqual([
      {
        withIncident: "true",
        processDefinitionKey: "order",
        sortBy: "instanceId",
        sortOrder: "asc",
        firstResult: "0",
        maxResults: "500",
      },
    ])
  })

  it.each([
    [
      "reads the listing on where it has fewer pages left than versions that run an instance",
      { failing: 5, running: 3 },
      ["page from 0", "count of the engine", "page from 2", "page from 4"],
    ],
    [
      "reads the listing on where its pages left are as many as those versions",
      { failing: 5, running: 2 },
      ["page from 0", "count of the engine", "page from 2", "page from 4"],
    ],
    [
      "counts each version that runs an instance where those are fewer than the pages left",
      { failing: 5, running: 1 },
      ["page from 0", "count of the engine", "count of order:1:v"],
    ],
    [
      "counts per version where a count that fills its last page costs the listing a page more",
      { failing: 4, running: 1 },
      ["page from 0", "count of the engine", "count of order:1:v"],
    ],
    [
      "reads the listing on to the empty page that ends it where that is as many requests",
      { failing: 4, running: 2 },
      ["page from 0", "count of the engine", "page from 2", "page from 4"],
    ],
  ])("past a full page, one count of the scope: %s", async (_name, world, requests) => {
    const versions = runningVersions(world.running)
    const failing = failingOver(
      world.failing,
      versions.filter(({ instances }) => instances > 0).map(({ id }) => id),
    )
    const port = engineOver(failing)

    const counts = await countsOver(port, versions, { pageSize: 2 })

    const expected = new Map<string, number>()
    for (const { definitionId } of failing) {
      expected.set(definitionId, (expected.get(definitionId) ?? 0) + 1)
    }
    expect(counts).toEqual(expected)
    expect(requestsOf(port)).toEqual(requests)
    expect(port.calls.map((call) => call.input.query.maxResults)).not.toContain("3")
  })

  it("counts a version list's scope by its key, and each of its versions by its id", async () => {
    const port = engineOver(failingOver(5, ["order:1:v"]))

    const counts = await withIncidentPerVersion(
      port,
      { processDefinitionKey: "order" },
      Promise.resolve(runningVersions(1)),
      { pageSize: 2 },
    )

    expect(counts).toEqual(new Map([["order:1:v", 5]]))
    expect(requestsOf(port)).toEqual(["page from 0", "count of order", "count of order:1:v"])
  })

  it("reads the listing on where it is told to, though the versions' counts send fewer", async () => {
    const port = engineOver(failingOver(5, ["order:1:v"]))

    const counts = await countsOver(port, runningVersions(1), { pageSize: 2, path: "listing" })

    expect(counts).toEqual(new Map([["order:1:v", 5]]))
    expect(requestsOf(port)).toEqual([
      "page from 0",
      "count of the engine",
      "page from 2",
      "page from 4",
    ])
  })

  it("counts each version that runs an instance where it is told to, though the listing sends fewer", async () => {
    const port = engineOver(failingOver(5, ["order:1:v"]))

    const counts = await countsOver(port, runningVersions(3), { pageSize: 2, path: "perVersion" })

    expect(counts).toEqual(
      new Map([
        ["order:1:v", 5],
        ["order:2:v", 0],
        ["order:3:v", 0],
      ]),
    )
    expect(requestsOf(port)).toEqual([
      "page from 0",
      "count of the engine",
      "count of order:1:v",
      "count of order:2:v",
      "count of order:3:v",
    ])
  })

  it("reads a listing that runs past the count to its end, its rows the numbers", async () => {
    const port = engineOver(failingOver(7, ["order:1:v", "order:2:v"]), { scope: 3 })

    const counts = await countsOver(port, runningVersions(5), { pageSize: 2 })

    expect(counts).toEqual(
      new Map([
        ["order:1:v", 4],
        ["order:2:v", 3],
      ]),
    )
    expect(requestsOf(port)).toEqual([
      "page from 0",
      "count of the engine",
      "page from 2",
      "page from 4",
      "page from 6",
    ])
  })

  it("reads one page on where the count fell below a page since, and counts what it lists", async () => {
    const port = engineOver(failingOver(2, ["order:1:v"]), { scope: 1 })

    const counts = await countsOver(port, runningVersions(1), { pageSize: 2 })

    expect(counts).toEqual(new Map([["order:1:v", 2]]))
    expect(requestsOf(port)).toEqual(["page from 0", "count of the engine", "page from 2"])
  })

  it("takes the versions' counts over the first page where the count picks them", async () => {
    const port = engineOver(failingOver(2, ["order:1:v"]), {
      scope: 9,
      byVersion: { "order:1:v": 1 },
    })

    const counts = await countsOver(port, runningVersions(1), { pageSize: 2 })

    expect(counts).toEqual(new Map([["order:1:v", 1]]))
    expect(requestsOf(port)).toEqual(["page from 0", "count of the engine", "count of order:1:v"])
  })

  it("counts none past a full page where the statistics run no instance", async () => {
    const port = engineOver(failingOver(2, ["order:1:v"]))

    const counts = await countsOver(port, runningVersions(0), { pageSize: 2 })

    expect(counts).toEqual(new Map())
    expect(requestsOf(port)).toEqual(["page from 0", "count of the engine"])
  })

  it("reads a page of one where it is told a page of none", async () => {
    const port = engineOver(failingOver(1, ["order:1:v"]))

    const counts = await countsOver(port, runningVersions(3), { pageSize: 0 })

    expect(counts).toEqual(new Map([["order:1:v", 1]]))
    expect(port.calls.map((call) => call.input.query.maxResults)).toEqual(["1", undefined, "1"])
  })

  it("fails an answer that is no list, never reading it as none", async () => {
    const port = fakePort({ getProcessInstances: () => ({ id: "p1" }) })

    await expect(countsOver(port, runningVersions(1))).rejects.toMatchObject({
      failure: "unexpectedResponse",
      message: "/process-instance is not a list",
    })
  })

  it("fails with the versions' read, whatever the listing found", async () => {
    const port = engineOver([])

    await expect(
      withIncidentPerVersion(port, {}, Promise.reject(new Error("no statistics"))),
    ).rejects.toThrow("no statistics")
  })
})
