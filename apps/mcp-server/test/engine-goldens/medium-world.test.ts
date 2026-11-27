import { describe, expect, it } from "vitest"
import type { EngineReply } from "./fake-engines.js"
import { answerOf, startMediumEngines } from "./medium-engines.js"
import { runningSegments } from "./medium-query.js"
import { within } from "./medium-segments.js"
import { mediumRoutes } from "./medium-routes.js"
import { endedIdOf, engineDate, instanceIdOf, MediumWorld, TIMES } from "./medium-world.js"

/**
 * The medium engine (medium-world.ts) answers as an engine does, or the request-count golden would
 * count reads no engine sends: each count is the length of the list it counts, each sorted page
 * holds the rows of the order asked for, the statistics agree with the lists, each object read by
 * its id is the one the lists hold, and a request it cannot answer as asked says so. On a small
 * engine of four processes, read in-process.
 */

const world = new MediumWorld({ keys: 4 })
const routes = mediumRoutes(world)

/** The world's answer to a GET, or to a POST of `body`; it must read every parameter. */
function ask(target: string, body?: Record<string, unknown>): EngineReply {
  const answered = answerOf(routes, body ? "POST" : "GET", target, body && JSON.stringify(body))
  expect(answered.unread, target).toEqual([])
  return answered.reply
}

const bodyOf = (reply: EngineReply) => reply.body as Array<Record<string, unknown>>
const countOf = (reply: EngineReply) => (reply.body as { count: number }).count

/** Every row of a list read, page by page as a client reads it. */
function everyRow(path: string, query: string, body?: Record<string, unknown>) {
  const rows: Array<Record<string, unknown>> = []
  for (let first = 0; ; first += 500) {
    const page = bodyOf(ask(`${path}?${query}&firstResult=${first}&maxResults=500`, body))
    rows.push(...page)
    if (page.length < 500) return rows
  }
}

const p04 = world.versionsOf("process-04")[0]
const HOUR = 3_600_000
const at = (time: number) => encodeURIComponent(engineDate(time))

/** List reads with the filters the server sends, each with its count's twin. */
interface ListRead {
  path: string
  query: string
  body?: Record<string, unknown>
}

const read = (path: string, query: string, body?: Record<string, unknown>): ListRead => ({
  path,
  query,
  ...(body ? { body } : {}),
})

const LISTS: readonly ListRead[] = [
  read("/process-instance", "withIncident=true"),
  read("/process-instance", "activityIdIn=callBilling&processDefinitionKey=process-04"),
  read("/process-instance", "incidentType=failedExternalTask"),
  read("/process-instance", "processDefinitionKey=billing&suspended=false&active=true"),
  read("/incident", "activityId=callBilling"),
  read("/incident", "incidentType=failedJob&processDefinitionKeyIn=process-04"),
  read("/incident", `incidentTimestampAfter=${at(TIMES.started(p04, 400))}`),
  read("/job", "noRetriesLeft=true"),
  read("/job", "withRetriesLeft=true&timers=false"),
  read("/job", `createTimes=lt_${at(TIMES.started(p04, 50))}`),
  read("/task", "unassigned=true&taskDefinitionKey=review"),
  read("/task", "assignee=demo"),
  read("/external-task", "noRetriesLeft=true"),
  read("/external-task", "withRetriesLeft=true"),
  read("/history/process-instance", "", { processDefinitionKey: "process-04", finished: true }),
  read("/history/process-instance", "", {
    processDefinitionId: p04.id,
    finishedAfter: engineDate(TIMES.ended(p04, 300)),
    finishedBefore: engineDate(TIMES.ended(p04, 100)),
  }),
  read("/history/process-instance", "", { processDefinitionKey: "billing", withIncidents: true }),
  read("/history/process-instance", "", {
    executedActivityIdIn: ["callBilling"],
    unfinished: true,
  }),
  read("/history/process-instance", "", {
    processDefinitionKey: "process-02",
    incidentStatus: "open",
  }),
  read("/history/process-instance", "", {
    processDefinitionKeyIn: ["process-02", "process-04"],
    executedActivityIdIn: ["callBilling", "end"],
    finished: true,
  }),
  read("/process-instance", `businessKey=bk-${instanceIdOf(p04, 6)}`),
  read("/history/activity-instance", "processDefinitionKey=process-04"),
  read("/history/incident", "incidentType=failedExternalTask"),
  read("/history/incident", "activityId=callBilling&processDefinitionKey=process-04"),
  read("/history/task", "processDefinitionKey=process-04"),
  read("/history/variable-instance", "processDefinitionKey=process-01"),
  read("/task", "processDefinitionKey=billing"),
]

describe("the medium engine counts what it lists", () => {
  it.each(LISTS)("$path?$query", ({ path, query, body }) => {
    const rows = everyRow(path, query, body)
    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map(({ id }) => id)).size).toBe(rows.length)
    expect(countOf(ask(`${path}/count?${query}`, body))).toBe(rows.length)
  })

  it("lists none where nothing matches: no instance is suspended, no job due later", () => {
    expect(countOf(ask("/process-instance/count?suspended=true"))).toBe(0)
    expect(countOf(ask("/history/task/count?finished=true"))).toBe(0)
    expect(countOf(ask("/job/count?timers=true"))).toBe(0)
    expect(countOf(ask(`/job/count?dueDates=gt_${at(TIMES.started(p04, 0))}`))).toBe(0)
    expect(bodyOf(ask("/external-task?locked=true"))).toEqual([])
  })

  it("cuts a list by its ids, its version and its times together", () => {
    const failed = instanceIdOf(p04, 6)
    const other = world.versionsOf("process-02")[0].id
    expect(countOf(ask(`/incident/count?processInstanceId=${failed}`))).toBe(1)
    expect(
      countOf(ask(`/incident/count?processInstanceId=${failed}&processDefinitionId=${other}`)),
    ).toBe(0)
    const later = at(TIMES.started(p04, 6) + 3 * TIMES.incidentAfter)
    expect(
      countOf(ask(`/incident/count?processInstanceId=${failed}&incidentTimestampAfter=${later}`)),
    ).toBe(0)
    expect(countOf(ask(`/history/incident/count?processInstanceId=${instanceIdOf(p04, 0)}`))).toBe(
      0,
    )
    const ended = endedIdOf(p04, 3)
    const before = engineDate(TIMES.ended(p04, 4))
    expect(
      countOf(
        ask("/history/process-instance/count", {
          processInstanceIds: [ended],
          finishedBefore: before,
        }),
      ),
    ).toBe(0)
  })

  it("cuts a segment by its times once or twice alike", () => {
    const [segment] = runningSegments(world, p04, () => true)
    const start = { time: "start", before: TIMES.started(p04, 10), after: TIMES.started(p04, 90) }
    const incident = { time: "incident", after: TIMES.started(p04, 50) }
    const once = within(segment, [start, incident])
    const twice = within(within(segment, [start]), [incident])
    expect(twice.count).toBe(once.count)
    expect(twice.row(0)).toEqual(once.row(0))
    // The instances 10 to 50: started within the bounds, their incident raised after the 50th started.
    expect(once.count).toBe(41)
  })
})

type Row = Record<string, unknown>

/** The rows' field each sort of the API orders by, where its name is not the field's. */
const FIELDS: Readonly<Record<string, (row: Row) => unknown>> = {
  incidentId: (row) => row.id,
  instanceId: (row) => row.id,
  jobId: (row) => row.id,
  activityInstanceId: (row) => row.id,
  jobRetries: (row) => row.retries,
  duration: (row) => row.durationInMillis,
  // An activity instance's place among its instance's steps.
  occurrence: (row) =>
    ({ start: 0, review: 1, callBilling: 2, charge: 2, notify: 3 })[row.activityId as string],
}

const valueOf = (sortBy: string, row: Row) =>
  (FIELDS[sortBy] ?? ((of: Row) => of[sortBy]))(row) as string | number

/** A sorted read: its filter (a GET's query, a POST's body) and the sorts it asks for. */
interface SortedRead {
  readonly path: string
  readonly filter: string | Row
  readonly sorting: ReadonlyArray<readonly [string, "asc" | "desc"]>
  /** The read as the test names it. */
  readonly name: string
}

const sortedBy = (
  path: string,
  filter: string | Row,
  ...sorting: Array<readonly [string, "asc" | "desc"]>
): SortedRead => {
  const sorts = sorting.map((sort) => sort.join(" ")).join(", ")
  const named = typeof filter === "string" ? filter : JSON.stringify(filter)
  return { path, filter, sorting, name: `${named} by ${sorts}` }
}

/** The request of a sorted read: a GET's one sort in its query, a POST's sorts in its body. */
function requestOf({ path, filter, sorting }: SortedRead, paging = "") {
  if (typeof filter !== "string") {
    const body = {
      ...filter,
      sorting: sorting.map(([sortBy, sortOrder]) => ({ sortBy, sortOrder })),
    }
    return { target: `${path}?${paging}`, body }
  }
  const [[sortBy, sortOrder]] = sorting
  return { target: `${path}?${filter}&sortBy=${sortBy}&sortOrder=${sortOrder}&${paging}` }
}

/** Whether `a` comes after `b` in the order `sorting` asks for. */
function after(sorting: SortedRead["sorting"], a: Row, b: Row): boolean {
  for (const [sortBy, sortOrder] of sorting) {
    const [left, right] = [valueOf(sortBy, a), valueOf(sortBy, b)]
    if (left !== right) return sortOrder === "asc" ? left > right : left < right
  }
  return false
}

/** The instances that ended last, of every version. */
const ENDED = { finishedAfter: engineDate(TIMES.ended(p04, 40)) }

/** Two processes whose versions share their numbers, so their ended instances tie in time. */
const TIED = ["process-01", "process-04"]

/** The sorts the server sends, and others the routes keep. */
const SORTED: readonly SortedRead[] = [
  sortedBy("/incident", "", ["incidentTimestamp", "desc"]),
  sortedBy("/incident", "processDefinitionKeyIn=process-04", ["incidentTimestamp", "desc"]),
  sortedBy("/incident", "activityId=callBilling", ["incidentId", "asc"]),
  sortedBy("/incident", "incidentType=failedJob", ["incidentId", "desc"]),
  sortedBy("/process-instance", "withIncident=true", ["instanceId", "asc"]),
  sortedBy(
    "/process-instance",
    `processInstanceIds=${[6, 0, 5, 9].map((n) => instanceIdOf(p04, n)).join(",")}`,
    ["instanceId", "desc"],
  ),
  sortedBy(
    "/process-instance",
    { processDefinitionKey: "process-04" },
    ["businessKey", "asc"],
    ["instanceId", "asc"],
  ),
  sortedBy("/job", {}, ["jobRetries", "asc"], ["jobId", "asc"]),
  sortedBy("/job", {}, ["jobRetries", "desc"], ["jobId", "desc"]),
  sortedBy("/task", "processDefinitionKey=process-02", ["created", "asc"]),
  sortedBy(
    "/history/process-instance",
    { processDefinitionKeyIn: TIED },
    ["startTime", "desc"],
    ["instanceId", "asc"],
  ),
  sortedBy(
    "/history/process-instance",
    { processDefinitionKey: "process-04", unfinished: true, activityIdIn: ["review"] },
    ["startTime", "desc"],
    ["instanceId", "asc"],
  ),
  sortedBy("/history/process-instance", ENDED, ["duration", "asc"]),
  sortedBy("/history/process-instance", ENDED, ["endTime", "desc"], ["instanceId", "desc"]),
  sortedBy(
    "/history/process-instance",
    { processInstanceIds: [endedIdOf(p04, 3), instanceIdOf(p04, 2), instanceIdOf(p04, 1)] },
    ["startTime", "asc"],
  ),
  sortedBy(
    "/history/activity-instance",
    { processDefinitionKey: "process-04" },
    ["startTime", "asc"],
    ["occurrence", "asc"],
    ["activityInstanceId", "asc"],
  ),
  sortedBy(
    "/history/activity-instance",
    { processInstanceId: instanceIdOf(p04, 8) },
    ["startTime", "desc"],
    ["occurrence", "desc"],
    ["activityInstanceId", "asc"],
  ),
  sortedBy("/history/incident", "", ["createTime", "desc"]),
  sortedBy("/history/incident", "processDefinitionKey=process-04", ["incidentId", "asc"]),
  sortedBy("/process-definition", "", ["id", "asc"]),
  sortedBy(
    "/process-definition",
    `processDefinitionIdIn=${[world.billing, p04].map(({ id }) => id).join(",")}`,
    ["id", "desc"],
  ),
  sortedBy("/process-definition", "", ["version", "desc"]),
]

describe("it keeps the order a read asks for", () => {
  it.each(SORTED)("$path $name", (read) => {
    const whole = requestOf(read)
    const rows = bodyOf(ask(whole.target, whole.body))
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.filter((row, at) => at > 0 && after(read.sorting, rows[at - 1], row))).toEqual([])
    // Page by page, the pages are its rows in its order.
    const pages: Row[] = []
    for (let first = 0; first < rows.length; first += 97) {
      const page = requestOf(read, `firstResult=${first}&maxResults=97`)
      pages.push(...bodyOf(ask(page.target, page.body)))
    }
    expect(pages).toEqual(rows)
    // The rows the read takes without a sort, in another order.
    const filter = typeof read.filter === "string" ? read.filter : ""
    const plain = bodyOf(
      ask(`${read.path}?${filter}`, typeof read.filter === "string" ? undefined : read.filter),
    )
    expect(new Set(rows.map(({ id }) => id))).toEqual(new Set(plain.map(({ id }) => id)))
    expect(rows).toHaveLength(plain.length)
  })

  it("puts rows of the same time side by side, as a sorting engine does", () => {
    const tied = (rows: Row[], field: string) =>
      rows.filter((row, at) => at > 0 && row[field] === rows[at - 1][field]).length
    const incidents = bodyOf(ask("/incident?sortBy=incidentTimestamp&sortOrder=desc"))
    // The 3 versions whose instances started at the same second have their charge failed at n=6.
    expect(tied(incidents, "incidentTimestamp")).toBeGreaterThan(0)
    const history = bodyOf(
      ask("/history/process-instance?", {
        processDefinitionKeyIn: TIED,
        finished: true,
        sorting: [{ sortBy: "startTime", sortOrder: "desc" }],
      }),
    )
    expect(tied(history, "startTime")).toBeGreaterThan(0)
  })

  it("sorts by a POST's sortBy as by its sorting, and pages past the last row to none", () => {
    const filter = { processDefinitionKey: "process-04" }
    const byPair = bodyOf(
      ask("/process-instance?maxResults=30", {
        ...filter,
        sortBy: "instanceId",
        sortOrder: "desc",
      }),
    )
    const bySorting = bodyOf(
      ask("/process-instance?maxResults=30", {
        ...filter,
        sorting: [{ sortBy: "instanceId", sortOrder: "desc" }],
      }),
    )
    expect(byPair).toEqual(bySorting)
    expect(byPair[0].id).toBe(instanceIdOf(world.versionsOf("process-04")[0], p04.running - 1))
    const beyond = "sortBy=incidentTimestamp&sortOrder=desc&firstResult=100000&maxResults=5"
    expect(bodyOf(ask(`/incident?${beyond}`))).toEqual([])
    expect(bodyOf(ask("/incident?incidentType=none&sortBy=incidentId&sortOrder=asc"))).toEqual([])
  })
})

describe("its statistics agree with its lists", () => {
  const statistics = (query: string) =>
    bodyOf(ask(`/process-definition/statistics?${query}`)) as Array<{
      instances: number
      failedJobs: number
      incidents: Array<{ incidentCount: number }>
    }>
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
  const incidents = (rows: ReturnType<typeof statistics>) =>
    sum(rows.flatMap((row) => row.incidents.map(({ incidentCount }) => incidentCount)))

  it("per version: the running instances, the root incidents, the failed jobs", () => {
    const roots = statistics("rootIncidents=true&failedJobs=true")
    expect(sum(roots.map((row) => row.instances))).toBe(countOf(ask("/process-instance/count?")))
    const copies = countOf(ask("/incident/count?activityId=callBilling"))
    expect(incidents(roots)).toBe(countOf(ask("/incident/count?")) - copies)
    expect(incidents(statistics("incidents=true"))).toBe(countOf(ask("/incident/count?")))
    expect(sum(roots.map((row) => row.failedJobs))).toBe(
      countOf(ask("/job/count?noRetriesLeft=true")),
    )
    expect(incidents(statistics(""))).toBe(0)
  })

  it("per element of a version: what waits there and the incidents it holds", () => {
    const elements = bodyOf(
      ask(`/process-definition/${p04.id}/statistics?failedJobs=true&incidents=true`),
    )
    expect(sum(elements.map((row) => row.instances as number))).toBe(p04.running)
    for (const row of elements) {
      const counted = countOf(
        ask(`/incident/count?processDefinitionId=${p04.id}&activityId=${row.id as string}`),
      )
      expect(incidents([row as never]), String(row.id)).toBe(counted)
    }
    const p02 = world.versionsOf("process-02")[0]
    expect(
      sum(
        bodyOf(ask(`/process-definition/${p02.id}/statistics`)).map(
          (row) => row.instances as number,
        ),
      ),
    ).toBe(p02.running)
    const plain = bodyOf(ask(`/process-definition/${p04.id}/statistics`))
    expect(plain.every((row) => row.failedJobs === 0 && (row.incidents as []).length === 0)).toBe(
      true,
    )
  })

  it("in the history: what started after a time passed an element or runs there", () => {
    const after = encodeURIComponent(engineDate(TIMES.started(p04, 200)))
    const stats = bodyOf(
      ask(
        `/history/process-definition/${p04.id}/statistics?finished=true&canceled=true&startedAfter=${after}`,
      ),
    )
    const review = stats.find(({ id }) => id === "review")!
    const started = countOf(
      ask(`/history/process-instance/count?processDefinitionId=${p04.id}&startedAfter=${after}`),
    )
    expect(review.instances as number).toBeLessThan(started)
    expect(
      bodyOf(
        ask(`/history/process-definition/${world.versionsOf("process-02")[0].id}/statistics`),
      ).every(({ finished }) => finished === 0),
    ).toBe(true)
  })
})

describe("its objects read by id are the ones its lists hold", () => {
  const failed = instanceIdOf(p04, 6)
  const review = instanceIdOf(p04, 0)
  const caller = instanceIdOf(p04, 5)

  it("an incident, a failed job's stacktrace, a user task", () => {
    expect(ask(`/incident/inc-${failed}`).body).toMatchObject({ processInstanceId: failed })
    // A copy's id is its instance's, as a root's; its root is the called instance's.
    const called = instanceIdOf(world.billing, world.calledBy(p04, 5))
    expect(ask(`/incident/inc-${caller}`).body).toMatchObject({
      activityId: "callBilling",
      rootCauseIncidentId: `inc-${called}`,
    })
    expect(ask(`/incident/inc-${called}`).body).toMatchObject({ activityId: "charge" })
    expect(ask(`/job/job-${failed}/stacktrace`).raw).toContain("insufficient funds")
    expect(bodyOf(ask(`/job?jobId=job-${failed}&maxResults=1`))).toEqual([
      expect.objectContaining({ id: `job-${failed}`, retries: 0 }),
    ])
    expect(ask(`/task/task-${review}`).body).toMatchObject({ processInstanceId: review })
    expect(ask(`/task/task-${review}/variables`).body).toHaveProperty("amount")
  })

  it.each([
    `/incident/inc-${review}`,
    `/incident/job-${failed}`,
    `/incident/inc-pi-3-3-6`,
    `/job/job-${instanceIdOf(p04, 7)}/stacktrace`,
    `/job/job-${review}/stacktrace`,
    `/task/task-${failed}`,
    `/task/pi-${review}`,
    `/task/task-pi-3-3-99999`,
    `/process-instance/pi-03-09-000001/variables`,
    `/process-instance/pi-03-03-999999`,
    `/process-instance/${endedIdOf(p04, 0)}`,
    "/process-definition/process-04:9:none/xml",
    "/deployment/dep-none",
    "/history/process-definition/none/statistics",
    `/history/process-instance/${endedIdOf(p04, p04.ended)}`,
  ])("none for %s", (target) => {
    expect(ask(target).status).toBe(404)
  })

  it("the instance a calling instance waits on, and back", () => {
    const [called] = bodyOf(ask(`/process-instance?superProcessInstance=${caller}`))
    expect(bodyOf(ask(`/process-instance?subProcessInstance=${called.id as string}`))).toEqual([
      expect.objectContaining({ id: caller }),
    ])
    expect(bodyOf(ask(`/process-instance?subProcessInstance=${caller}`))).toEqual([])
    // A called instance whose charge did not fail waits at review: it passed only the start.
    const [waiting] = bodyOf(ask(`/process-instance?superProcessInstance=${instanceIdOf(p04, 15)}`))
    expect(
      countOf(ask(`/history/activity-instance/count?processInstanceId=${waiting.id as string}`)),
    ).toBe(2)
    expect(bodyOf(ask(`/process-instance?superProcessInstance=${review}`))).toEqual([])
    const history = bodyOf(ask("/history/process-instance", { superProcessInstanceId: caller }))
    expect(history).toEqual([
      expect.objectContaining({ id: called.id, superProcessInstanceId: caller }),
    ])
    expect(ask(`/history/process-instance/${called.id as string}`).body).toMatchObject({
      rootProcessInstanceId: caller,
    })
  })

  it("an ended instance by its id and its business key, and none beyond the last", () => {
    const ended = endedIdOf(p04, 3)
    expect(ask(`/history/process-instance/${ended}`).body).toMatchObject({
      id: ended,
      state: "COMPLETED",
    })
    expect(
      bodyOf(ask("/history/process-instance", { processInstanceBusinessKey: `bk-${ended}` })),
    ).toHaveLength(1)
    expect(
      bodyOf(ask("/history/process-instance", { processInstanceIds: [endedIdOf(p04, p04.ended)] })),
    ).toEqual([])
    expect(
      bodyOf(ask("/history/process-instance", { processInstanceIds: [ended], finished: true })),
    ).toHaveLength(1)
  })

  it("the activities of an instance, its variables, its versions and deployments", () => {
    expect(countOf(ask(`/history/activity-instance/count?processInstanceId=${caller}`))).toBe(3)
    expect(bodyOf(ask(`/variable-instance?processInstanceIdIn=${caller}`))).toHaveLength(4)
    expect(bodyOf(ask("/variable-instance?"))).toEqual([])
    expect(bodyOf(ask("/variable-instance?processInstanceIdIn=pi-3-3-99999"))).toEqual([])
    expect(
      bodyOf(ask("/process-definition?key=process-04&sortBy=version&sortOrder=desc"))[0],
    ).toMatchObject({ version: 3 })
    expect(bodyOf(ask("/process-definition?keysIn=process-04&version=2"))).toHaveLength(1)
    const deployedAfter = encodeURIComponent(engineDate(TIMES.started(p04, 0) - 30 * 24 * HOUR))
    expect(
      countOf(ask(`/process-definition/count?latestVersion=true&deployedAfter=${deployedAfter}`)),
    ).toBe(5)
    expect(countOf(ask("/deployment/count"))).toBe(everyRow("/deployment", "").length)
    expect(ask(`/deployment/${p04.deploymentId}`).body).toMatchObject({
      id: p04.deploymentId,
      name: p04.key,
    })
  })

  it("a version's diagram: the elements its numbers name, a call to billing where it calls", () => {
    for (const version of [p04, world.versionsOf("process-02")[0], world.billing]) {
      const { id, bpmn20Xml } = ask(`/process-definition/${version.id}/xml`).body as {
        id: string
        bpmn20Xml: string
      }
      expect(id).toBe(version.id)
      expect(bpmn20Xml).toContain(`<bpmn:process id="${version.key}"`)
      const elements = [...bpmn20Xml.matchAll(/<bpmn:\w+ id="(\w+)"/g)].map((match) => match[1])
      const counted = (path: string) => bodyOf(ask(path)).map((row) => row.id)
      expect(elements).toEqual(
        expect.arrayContaining([
          ...counted(`/process-definition/${version.id}/statistics`),
          ...counted(`/history/process-definition/${version.id}/statistics`),
        ]),
      )
      expect(elements.includes("callBilling")).toBe(version.caller)
    }
  })

  it.each([
    [0, "review"],
    [5, "callBilling"],
    [6, "charge"],
    [7, "charge"],
    [8, "notify"],
  ])("the activity tree of instance %i: where its history is open, %s", (n, element) => {
    const id = instanceIdOf(p04, n)
    const tree = ask(`/process-instance/${id}/activity-instances`).body as {
      id: string
      childActivityInstances: Row[]
      childTransitionInstances: Row[]
    }
    const open = bodyOf(ask(`/history/activity-instance?processInstanceId=${id}`)).filter(
      (row) => row.endTime === null,
    )
    expect(tree.id).toBe(id)
    expect(open).toEqual([expect.objectContaining({ activityId: element })])
    // The charge is asynchronous: an instance before it waits in a transition.
    const [waiting] =
      element === "charge" ? tree.childTransitionInstances : tree.childActivityInstances
    expect(waiting).toMatchObject({ activityId: element, processInstanceId: id })
    expect(tree.childActivityInstances.length + tree.childTransitionInstances.length).toBe(1)
  })

  it("the job definition of a version: the one its jobs and its failed charges name", () => {
    const definitions = bodyOf(ask(`/job-definition?processDefinitionId=${p04.id}`))
    expect(definitions).toEqual([
      expect.objectContaining({ processDefinitionId: p04.id, activityId: "charge" }),
    ])
    expect(bodyOf(ask("/job-definition?processDefinitionKey=process-02"))).toHaveLength(
      world.versionsOf("process-02").length,
    )
    const jobs = bodyOf(ask(`/job?processDefinitionId=${p04.id}&firstResult=0&maxResults=20`))
    expect(new Set(jobs.map((job) => job.jobDefinitionId))).toEqual(new Set([definitions[0].id]))
    expect(ask(`/incident/inc-${failed}`).body).toMatchObject({
      jobDefinitionId: definitions[0].id,
      configuration: `job-${failed}`,
    })
  })

  it("the engine's version and telemetry, and none of what it holds none of", () => {
    expect(ask("/version").body).toEqual({ version: "2.1.0" })
    expect(ask("/telemetry/data").body).toMatchObject({ product: { name: "CIB seven" } })
    expect(
      bodyOf(ask(`/event-subscription?eventType=message&processInstanceId=${review}`)),
    ).toEqual([])
    expect(bodyOf(ask("/batch/statistics?type=instance-migration"))).toEqual([])
    expect(countOf(ask("/batch/statistics/count?type=instance-migration"))).toBe(0)
  })
})

describe("it says what it cannot answer as asked", () => {
  it("a route it lacks, a parameter it ignores", () => {
    expect(answerOf(routes, "DELETE", "/process-instance/x").operation).toBe(
      "unanswered: DELETE /process-instance/x",
    )
    expect(answerOf(routes, "GET", "/process-instance/count?tenantIdIn=t1").unread).toEqual([
      "tenantIdIn",
    ])
  })

  it.each([
    ["/incident?sortBy=incidentMessage&sortOrder=asc", undefined, ["sortBy", "sortOrder"]],
    ["/incident?sortBy=incidentTimestamp", undefined, ["sortBy"]],
    ["/incident?sortOrder=desc", undefined, ["sortOrder"]],
    ["/incident/count?sortBy=incidentTimestamp&sortOrder=desc", undefined, ["sortBy", "sortOrder"]],
    // A running instance has no duration yet: the world does not place it.
    [
      "/history/process-instance?sortBy=duration&sortOrder=asc&maxResults=1",
      undefined,
      ["sortBy", "sortOrder"],
    ],
    [
      "/history/variable-instance?sortBy=variableName&sortOrder=asc&maxResults=1",
      undefined,
      ["sortBy", "sortOrder"],
    ],
    ["/process-instance?", { sorting: [{ sortBy: "constructor", sortOrder: "asc" }] }, ["sorting"]],
    ["/process-instance?", { sorting: [{ sortBy: "instanceId", sortOrder: "up" }] }, ["sorting"]],
  ])("an order it does not keep: %s %j", (target, body, unread) => {
    const method = body ? "POST" : "GET"
    expect(answerOf(routes, method, target, body && JSON.stringify(body)).unread).toEqual(unread)
  })

  it("a request below no engine's REST root, over the wire", async () => {
    const engines = await startMediumEngines({ e1: routes })
    try {
      const answer = await fetch(new URL("/other", engines.urlOf("e1")))
      expect(answer.status).toBe(404)
      expect(engines.sent).toEqual([
        { engine: "", operation: "unanswered: GET /other", status: 404, unread: [] },
      ])
      const posted = await fetch(`${engines.urlOf("e1")}/process-instance/count`, {
        method: "POST",
        body: JSON.stringify({ processDefinitionKey: "billing" }),
      })
      expect(await posted.json()).toEqual({ count: world.billing.running })
      expect(engines.sent.at(-1)).toEqual({
        engine: "e1",
        operation: "POST /process-instance/count",
        status: 200,
        unread: [],
      })
      engines.reset()
      expect(engines.sent).toEqual([])
    } finally {
      await engines.close()
    }
  })
})
