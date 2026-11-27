import { BpmnProcessId, ElementId, PageCursor } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakePort, type FakePort, type Route, turningTies } from "../testing/fake-port.js"
import { ROOT, secondsBefore } from "../testing/incident-search.test-support.js"
import { type ElementRef, ElementIncidentSearch } from "./element-incidents.js"

// The search over one process's versions (F17b of #689): a process, a key in one tenant whose key
// holds others, is searched by its versions' ids, so another tenant's incidents are never read.

const ASSESS = "Activity_Assess"
const BODY = `${ASSESS}#multiInstanceBody`
const NORTH_1 = "order:1:north"
const NORTH_2 = "order:2:north"
const SOUTH = "order:3:south"

/** The search of one process's versions `definitionIds` at the element. */
const inVersions = (...definitionIds: string[]): ElementRef => ({
  bpmnProcessId: BpmnProcessId("order"),
  elementId: ElementId(ASSESS),
  definitionIds,
})

/** A root incident `id` of `version` at `activityId`, raised `seconds` before ROOT. */
function rootAt(version: string, activityId: string, id: string, seconds: number) {
  return {
    ...ROOT,
    id,
    activityId,
    processDefinitionId: version,
    rootCauseIncidentId: id,
    incidentTimestamp: secondsBefore(seconds),
  }
}

type Row = ReturnType<typeof rootAt>

/**
 * An engine answering the incidents by a version's id and an activity id, each list's ties turned
 * on every request; a search by key reads every version's.
 */
function engineOf(rows: readonly Row[]): FakePort {
  const lists = new Map<string, Route>()
  const listOf = (version: string | undefined, activityId: string | undefined): Route => {
    const at = JSON.stringify([version ?? "*", activityId])
    const known = lists.get(at)
    if (known !== undefined) return known
    const listed = rows.filter(
      (row) =>
        (version === undefined || row.processDefinitionId === version) &&
        row.activityId === activityId,
    )
    const route = turningTies(listed, (row) => row.incidentTimestamp)
    lists.set(at, route)
    return route
  }
  return fakePort({
    getIncidents: (input) => listOf(input.query.processDefinitionId, input.query.activityId)(input),
  })
}

const idsOf = (page: { readonly items: readonly { readonly id: string }[] }) =>
  page.items.map((incident) => incident.id)

/** Every page of `element` from the first on, at most 100: the ids of each, and their cursors. */
async function walk(port: FakePort, element: ElementRef, limit: number) {
  const search = new ElementIncidentSearch(port)
  const pages: string[][] = []
  const cursors: (string | undefined)[] = []
  let after: PageCursor | undefined
  do {
    const page = await search.search(element, after === undefined ? { limit } : { limit, after })
    pages.push(idsOf(page))
    after = page.next
    cursors.push(after)
  } while (after !== undefined && pages.length < 100)
  return { pages, cursors }
}

describe("ElementIncidentSearch.search over one process's versions", () => {
  // North's two versions hold three root incidents at the element and one at its body; south's
  // version, the same key in another tenant, holds newer ones.
  const north = [
    rootAt(NORTH_2, ASSESS, "inc-n0", 10),
    rootAt(NORTH_1, BODY, "inc-n1", 11),
    rootAt(NORTH_1, ASSESS, "inc-n2", 12),
    rootAt(NORTH_2, ASSESS, "inc-n3", 13),
  ]
  const south = Array.from({ length: 5 }, (_, n) => rootAt(SOUTH, ASSESS, `inc-s${n}`, n))

  it("reads each version by its id, never the key, and merges them newest first", async () => {
    const port = engineOf([...north, ...south])

    const page = await new ElementIncidentSearch(port).search(inVersions(NORTH_1, NORTH_2), {
      limit: 10,
    })

    expect(idsOf(page)).toStrictEqual(["inc-n0", "inc-n1", "inc-n2", "inc-n3"])
    expect(page.next).toBeUndefined()
    const asked = port.calls.map(({ input: { query } }) => [
      query.processDefinitionId,
      query.processDefinitionKeyIn,
      query.activityId,
    ])
    expect(asked).toStrictEqual([
      [NORTH_1, undefined, ASSESS],
      [NORTH_1, undefined, BODY],
      [NORTH_2, undefined, ASSESS],
      [NORTH_2, undefined, BODY],
    ])
  })

  it("lists every incident once, in order, where the versions' lists tie and turn", async () => {
    const tied = [0, 0, 0, 1, 1, 2].flatMap((seconds, n) => [
      rootAt(NORTH_1, ASSESS, `inc-${n}a`, seconds),
      rootAt(NORTH_2, n % 2 === 0 ? BODY : ASSESS, `inc-${n}b`, seconds),
    ])
    const order = [...tied]
      .sort((left, right) =>
        left.incidentTimestamp === right.incidentTimestamp
          ? left.id.localeCompare(right.id)
          : right.incidentTimestamp.localeCompare(left.incidentTimestamp),
      )
      .map((row) => row.id)

    for (const limit of [1, 2, 3, 5, 20]) {
      const { pages } = await walk(engineOf(tied), inVersions(NORTH_1, NORTH_2), limit)

      expect(pages.flat(), `pages of ${limit}`).toStrictEqual(order)
      expect(pages.slice(0, -1).every((ids) => ids.length === limit)).toBe(true)
    }
  })

  it("names each version's places in its cursor, a version read to its end left out", async () => {
    const port = engineOf(north)
    const search = new ElementIncidentSearch(port)

    const first = await search.search(inVersions(NORTH_1, NORTH_2), { limit: 2 })

    expect(idsOf(first)).toStrictEqual(["inc-n0", "inc-n1"])
    expect(first.next).toBe("order%3A1%3Anorth=0,-;order%3A2%3Anorth=1,-")
    const second = await search.search(inVersions(NORTH_1, NORTH_2), {
      limit: 2,
      after: PageCursor(first.next ?? ""),
    })
    expect(second).toStrictEqual({ items: [north[2], north[3]] })
  })

  it("goes on in the versions its cursor names that are still named, never in one named since", async () => {
    const port = engineOf([...north, rootAt(SOUTH, ASSESS, "inc-s", 20)])
    const search = new ElementIncidentSearch(port)
    const first = await search.search(inVersions(NORTH_1, NORTH_2), { limit: 2 })
    const after = PageCursor(first.next ?? "")
    const before = port.calls.length

    const page = await search.search(inVersions(NORTH_2, SOUTH), { limit: 5, after })

    expect(idsOf(page)).toStrictEqual(["inc-n3"])
    expect(port.calls.slice(before).map(({ input }) => input.query.processDefinitionId)).toEqual([
      NORTH_2,
    ])
  })

  it("reads nothing for a process whose versions hold none", async () => {
    const port = engineOf(south)

    const page = await new ElementIncidentSearch(port).search(inVersions(), { limit: 5 })

    expect(page).toStrictEqual({ items: [] })
    expect(port.calls).toStrictEqual([])
  })

  it.each([
    "0,-",
    "-",
    "order%3A1%3Anorth",
    "order%3A1%3Anorth=0",
    "=0,-",
    "%E0%A4%A=0,-",
    "order%3A1%3Anorth=0,-=1",
    "order%3A1%3Anorth=0,-;order%3A1%3Anorth=1,-",
  ])(
    "fails the cursor %j as no cursor of a process's paging, before anything is read",
    async (after) => {
      const port = engineOf(north)

      await expect(
        new ElementIncidentSearch(port).search(inVersions(NORTH_1), {
          limit: 5,
          after: PageCursor(after),
        }),
      ).rejects.toThrow(new RangeError(`"${after}" is not a page cursor of this engine`))
      expect(port.calls).toStrictEqual([])
    },
  )

  it("fails a process's cursor in the search of its key", async () => {
    const port = engineOf(north)
    const element = { bpmnProcessId: BpmnProcessId("order"), elementId: ElementId(ASSESS) }

    await expect(
      new ElementIncidentSearch(port).search(element, {
        limit: 5,
        after: PageCursor("order%3A1%3Anorth=0,-"),
      }),
    ).rejects.toThrow(RangeError)
  })
})
