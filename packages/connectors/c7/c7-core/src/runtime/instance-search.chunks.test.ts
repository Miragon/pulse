import {
  ElementId,
  InstanceId,
  type InstanceSummary,
  type PageCursor,
  RuntimeError,
} from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { type FakeCall, fakePort, type Route } from "../testing/fake-port.js"
import { C7Runtime } from "./c7-runtime.js"
import { InstanceSearch } from "./instance-search.js"

/** Ten running instances, p0 the oldest; p1, p3, p4, p6 and p8 hold an incident. */
const ROWS = Array.from({ length: 10 }, (_, index) => ({
  id: `p${String(index)}`,
  processDefinitionId: "order:1:a",
  processDefinitionKey: "order",
  processDefinitionVersion: 1,
  state: "ACTIVE",
  startTime: `2026-10-21T18:44:0${String(index)}.000+0000`,
}))
const NEWEST_FIRST = [...ROWS].reverse()
const WITH_INCIDENT = ["p1", "p3", "p4", "p6", "p8"]
/** The instances waiting at Activity_Pack. */
const AT_PACK = ["p0", "p3", "p6", "p8"]

interface HistoryBody {
  readonly processInstanceIds?: readonly string[]
  readonly activityIdIn?: readonly string[]
}

function matching(body: HistoryBody): typeof ROWS {
  return NEWEST_FIRST.filter(
    ({ id }) =>
      (body.processInstanceIds?.includes(id) ?? true) &&
      (body.activityIdIn === undefined || AT_PACK.includes(id)),
  )
}

/** The runtime's instances with an incident: a page of them by id, or the flags of listed ids. */
const runtime: Route = (input) => {
  const listed = input.query.processInstanceIds
  if (listed !== undefined) {
    return listed
      .split(",")
      .filter((id) => WITH_INCIDENT.includes(id))
      .map((id) => ({ id, definitionId: "order:1:a" }))
  }
  const first = Number(input.query.firstResult)
  return WITH_INCIDENT.slice(first, first + Number(input.query.maxResults)).map((id) => ({
    id,
    definitionId: "order:1:a",
  }))
}

const ROUTES: Readonly<Record<string, Route>> = {
  getProcessInstances: runtime,
  queryHistoricProcessInstances: (input) => {
    const first = Number(input.query.firstResult)
    return matching(input.body as HistoryBody).slice(first, first + Number(input.query.maxResults))
  },
  queryHistoricProcessInstancesCount: (input) => ({
    count: matching(input.body as HistoryBody).length,
  }),
}

function searchOver(chunk: number) {
  const port = fakePort(ROUTES)
  return { port, search: new InstanceSearch(port, chunk) }
}

/** The ids each request to the history carried, and none sent no ids. */
function historyIdsOf(calls: readonly FakeCall[]): unknown[] {
  return calls
    .filter((call) => call.operationId.startsWith("queryHistoricProcessInstances"))
    .map((call) => (call.input.body as HistoryBody).processInstanceIds)
}

async function everyPage(
  search: InstanceSearch,
  withIncident: boolean,
  limit: number,
): Promise<readonly (readonly InstanceSummary[])[]> {
  const pages: (readonly InstanceSummary[])[] = []
  let after: PageCursor | undefined
  do {
    const page = await search.search(
      { withIncident },
      after === undefined ? { limit } : { limit, after },
    )
    pages.push(page.items)
    after = page.next
  } while (after !== undefined)
  return pages
}

describe("InstanceSearch over more instances with an incident than one request carries", () => {
  it("pages them newest first across the chunks, without a gap or a repeat", async () => {
    const { port, search } = searchOver(2)

    const pages = await everyPage(search, true, 2)

    expect(pages.map((items) => items.map((item) => item.id))).toStrictEqual([
      ["p8", "p6"],
      ["p4", "p3"],
      ["p1"],
    ])
    expect(pages.flat().every((item) => item.hasIncident)).toBe(true)
    const sent = historyIdsOf(port.calls)
    expect(sent).toHaveLength(9)
    expect(sent.slice(0, 3)).toStrictEqual([["p1", "p3"], ["p4", "p6"], ["p8"]])
  })

  it("counts them at an element as the sum of the chunks' counts", async () => {
    const { port, search } = searchOver(2)

    const counted = await search.count({
      withIncident: true,
      activeElementId: ElementId("Activity_Pack"),
    })

    expect(counted).toBe(3)
    expect(historyIdsOf(port.calls)).toStrictEqual([["p1", "p3"], ["p4", "p6"], ["p8"]])
  })

  it("counts those without as the history's count less the chunks' counts", async () => {
    const { port, search } = searchOver(2)

    expect(await search.count({ withIncident: false })).toBe(5)
    expect(historyIdsOf(port.calls)).toStrictEqual([undefined, ["p1", "p3"], ["p4", "p6"], ["p8"]])
  })

  it("pages those without over the given ids in chunks, flagging every running row", async () => {
    const { port, search } = searchOver(2)
    const instanceIds = ["p0", "p1", "p2", "p3", "p7"].map((id) => InstanceId(id))

    const page = await search.search({ withIncident: false, instanceIds }, { limit: 2 })

    expect(page.items.map((item) => [item.id, item.hasIncident])).toStrictEqual([
      ["p7", false],
      ["p2", false],
    ])
    expect(page.next).toBe("4")
    expect(historyIdsOf(port.calls).every((ids) => (ids as string[]).length <= 2)).toBe(true)
  })

  it("pages the given ids with an incident in chunks of those the runtime holds one for", async () => {
    const { port, search } = searchOver(1)
    const instanceIds = ["p0", "p3", "p8", "p6"].map((id) => InstanceId(id))

    const page = await search.search({ withIncident: true, instanceIds }, { limit: 5 })

    expect(page.items.map((item) => item.id)).toStrictEqual(["p8", "p6", "p3"])
    expect(historyIdsOf(port.calls)).toStrictEqual([["p3"], ["p6"], ["p8"]])
  })
})

describe("C7Runtime's chunk of instance ids", () => {
  const failureOf = (error: unknown) => new RuntimeError("unreachable", String(error))

  it("is the runtime's option where a surface sets one", async () => {
    const port = fakePort(ROUTES)
    const runtime = C7Runtime.over(port, { failureOf, historyIdChunk: 3 })

    expect(await runtime.countInstances({ withIncident: false })).toStrictEqual({ count: 5 })
    expect(historyIdsOf(port.calls)).toStrictEqual([undefined, ["p1", "p3", "p4"], ["p6", "p8"]])
  })

  it("is 500 ids without one", async () => {
    const many = Array.from({ length: 501 }, (_, index) => `x${String(index)}`)
    const port = fakePort({
      getProcessInstances: (input) => {
        const first = Number(input.query.firstResult)
        const ids = many.slice(first, first + Number(input.query.maxResults))
        return ids.map((id) => ({ id, definitionId: "order:1:a" }))
      },
      queryHistoricProcessInstancesCount: () => ({ count: 0 }),
    })

    await C7Runtime.over(port, { failureOf }).countInstances({ withIncident: false })

    expect(
      historyIdsOf(port.calls).map((ids) => (ids as string[] | undefined)?.length),
    ).toStrictEqual([undefined, 500, 1])
  })
})
