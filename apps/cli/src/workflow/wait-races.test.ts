/**
 * Waits that race the job executor (design §17.2.6). A poll reads the tree, then counts, one
 * request after the other, while the job executor commits whenever it likes. These tests let a
 * job executor transaction commit between two given requests and check that the wait never
 * reports `idle` for an instance that is not idle.
 */

import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { depsOf } from "../../test/support/engine-port.js"
import { BASE_URL, engineError, json, type RecordedRequest } from "../../test/support/fake-fetch.js"
import { WorkflowEngine } from "../../test/support/workflow-engine.js"
import { type WaitSettings, waitAndInspect } from "./wait.js"

const IDLE: WaitSettings = {
  conditions: [{ kind: "idle" }],
  timeoutMs: 60_000,
  failOnIncident: true,
  executeJobs: false,
}
const VIEW = { variables: false, history: false, stacktrace: false }
const TARGET = { id: "pi-1", known: true }

/**
 * The fake engine at the asynchronous job of `book`, whose job executor fails the job for good
 * (retries 0 and the failedJob incident, one transaction) right after it answered request number
 * `after`, before it reads the next one.
 */
function failingAfter(after: number) {
  const engine = new WorkflowEngine("book")
  let answered = 0
  const fetch: typeof globalThis.fetch = (input, init) => {
    const response = engine.fetch(input, init)
    answered += 1
    if (answered === after) engine.tick()
    return response
  }
  return { engine, deps: depsOf(fetch) }
}

describe("a job that fails for good while a poll reads", () => {
  it("fails with INCIDENT when the failure commits between the counts of the first poll", async () => {
    // advance --wait right after the timer: the job executor fails the job of book within
    // milliseconds, while the first poll reads. Requests 3 and 4 are its counts; operate 0.5.0 sent
    // the incident count third, in parallel with the job count, saw neither and reported idle.
    const { engine, deps } = failingAfter(3)
    const result = await waitAndInspect(deps, TARGET, IDLE, VIEW)
    expect(result.failure).toMatchObject({ code: "INCIDENT" })
    expect(result.view).toMatchObject({ incidents: [{ id: "inc-1", activityId: "book" }] })
    expect(engine.requests.slice(0, 4).map((request) => request.path)).toEqual([
      "/process-instance/pi-1",
      "/process-instance",
      "/job/count",
      "/process-instance/count",
    ])
    expect(deps.sleeps).toEqual([])
  })

  it("never reports idle, whichever request the failure commits after", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 60 }), async (after) => {
        const { deps } = failingAfter(after)
        const result = await waitAndInspect(deps, TARGET, IDLE, VIEW)
        expect(result.failure?.code).toBe("INCIDENT")
        expect(result.view).not.toHaveProperty("waited")
      }),
      { numRuns: 60, examples: [[3], [4]] },
    )
  })
})

const T0 = "2026-10-09T10:00:00.000+0000"

type Route = (request: RecordedRequest) => unknown

/** A fake engine of routes by pattern (JSON or a Response); a request without a route fails. */
function routed(routes: readonly (readonly [RegExp, Route])[], served?: (path: string) => void) {
  const requests: RecordedRequest[] = []
  const fetch: typeof globalThis.fetch = (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    const path = url.pathname.slice(new URL(BASE_URL).pathname.length)
    const request = { method: "GET", url: url.href, path, query: url.searchParams, headers: {} }
    requests.push({ ...request, body: undefined })
    const route = routes.find(([pattern]) => pattern.test(path))
    if (route === undefined) return Promise.reject(new Error(`No fake route for ${path}`))
    const answer = route[1]({ ...request, body: undefined })
    const response = answer instanceof Response ? answer : json(answer)
    served?.(path)
    return Promise.resolve(response)
  }
  return { fetch, requests }
}

/** The ids of an id list query parameter. */
function idsOf(request: RecordedRequest, name: string): string[] {
  return (request.query.get(name) ?? "").split(",")
}

/** The answers of an instance that rests, besides its tree and jobs: no incident, task or subscription. */
const RESTING: readonly (readonly [RegExp, Route])[] = [
  [
    /^\/history\/process-instance\/x$/,
    () => ({ id: "x", state: "ACTIVE", processDefinitionId: "parent:1:d", startTime: T0 }),
  ],
  [
    /^\/process-instance\/([^/]+)\/activity-instances$/,
    (request) => ({
      id: request.path.split("/")[2],
      activityId: "def",
      childActivityInstances: [],
      childTransitionInstances: [],
    }),
  ],
  [/^\/(incident|event-subscription|task|external-task|job|process-definition)$/, () => []],
  [/^\/job-definition$/, () => []],
  [/^\/process-instance\/count$/, () => ({ count: 0 })],
]

describe("a tree that changes while a poll reads", () => {
  /**
   * Parent `x` waits for the asynchronous job of `holder` (x itself before a call activity, or the
   * called instance before it, e.g. the item of a sequential multi-instance call activity). The
   * job executor runs that job in one transaction that starts the called instance `c` (ending the
   * old one, if any), whose asynchronous start job is due; it commits right after the engine
   * answered the first tree request (between the tree and the job count of the first poll). The
   * job executor runs the job of `c` on the first sleep, then `c` rests.
   */
  function callingEngine(
    children: readonly string[],
    holder: string,
    extra: readonly (readonly [RegExp, Route])[] = [],
  ) {
    let stage: "before" | "started" | "rest" = "before"
    const engine = routed(
      [
        [/^\/process-instance\/x$/, () => ({ id: "x", definitionId: "parent:1:d" })],
        [
          /^\/process-instance$/,
          (request) => {
            if (request.query.get("superProcessInstance") !== "x") return []
            const ids = stage === "before" ? children : ["c"]
            return ids.map((id) => ({ id, definitionId: "child:1:d" }))
          },
        ],
        [
          /^\/job\/count$/,
          (request) => {
            const owner = stage === "before" ? holder : stage === "started" ? "c" : undefined
            return {
              count: idsOf(request, "processInstanceIds").filter((id) => id === owner).length,
            }
          },
        ],
        ...extra,
        ...RESTING,
      ],
      (path) => {
        if (stage === "before" && path === "/process-instance") stage = "started"
      },
    )
    const deps = depsOf(engine.fetch, () => {
      if (stage === "started") stage = "rest"
    })
    return { engine, deps, stage: () => stage }
  }

  it.each([
    ["the parent job starts it", [], "x", ["x", "x,c"]],
    ["it replaces the instance whose job ended it", ["c1"], "c1", ["x,c1", "x,c"]],
  ])(
    "waits for the job of the called instance instead of reporting idle (%s)",
    async (_, children, holder, counted) => {
      const { engine, deps, stage } = callingEngine(children, holder)
      const result = await waitAndInspect(deps, { id: "x", known: true }, IDLE, VIEW)
      expect(result.failure).toBeUndefined()
      expect(result.view).toMatchObject({ waited: { until: "idle", polls: 2 } })
      expect(deps.sleeps).toEqual([250])
      expect(stage()).toBe("rest")
      // poll 1 counted the jobs of the tree it read and found the tree changed after the counts;
      // poll 2 counted the new tree
      const jobCounts = engine.requests.filter((request) => request.path === "/job/count")
      expect(jobCounts.map((request) => request.query.get("processInstanceIds"))).toEqual(counted)
    },
  )

  it("lets the other conditions decide when the tree changed under idle", async () => {
    // an open task found in the tree exists, whatever the tree did meanwhile; only idle needs a
    // tree that held still
    const task: readonly [RegExp, Route] = [/^\/task\/count$/, () => ({ count: 1 })]
    const { deps } = callingEngine([], "x", [task])
    const settings = {
      ...IDLE,
      conditions: [{ kind: "idle" as const }, { kind: "task" as const }],
    }
    const result = await waitAndInspect(deps, { id: "x", known: true }, settings, VIEW)
    expect(result.view).toMatchObject({ waited: { until: "task", polls: 1 } })
    expect(deps.sleeps).toEqual([])
  })

  it("confirms an idle tree that held still with one more read of the tree", async () => {
    const engine = routed([
      [/^\/process-instance\/x$/, () => ({ id: "x", definitionId: "parent:1:d" })],
      [/^\/process-instance$/, () => []],
      [/^\/job\/count$/, () => ({ count: 0 })],
      ...RESTING,
    ])
    const deps = depsOf(engine.fetch)
    const result = await waitAndInspect(deps, { id: "x", known: true }, IDLE, VIEW)
    expect(result.view).toMatchObject({ waited: { until: "idle", polls: 1 } })
    const paths = engine.requests.map((request) => request.path)
    expect(paths.slice(0, 6)).toEqual([
      "/process-instance/x",
      "/process-instance",
      "/job/count",
      "/process-instance/count",
      "/process-instance/x",
      "/process-instance",
    ])
  })

  it("reads the tree once more only for idle, not for the other conditions", async () => {
    const engine = routed([
      [/^\/process-instance\/x$/, () => ({ id: "x", definitionId: "parent:1:d" })],
      [/^\/process-instance$/, () => []],
      [/^\/task\/count$/, () => ({ count: 1 })],
      ...RESTING,
    ])
    const settings = { ...IDLE, conditions: [{ kind: "task" as const }] }
    const result = await waitAndInspect(
      depsOf(engine.fetch),
      { id: "x", known: true },
      settings,
      VIEW,
    )
    expect(result.view).toMatchObject({ waited: { until: "task", polls: 1 } })
    expect(engine.requests.slice(0, 6).map((request) => request.path)).toEqual([
      "/process-instance/x",
      "/process-instance",
      "/task/count",
      "/process-instance/count",
      // the view
      "/process-instance/x",
      "/history/process-instance/x",
    ])
  })

  it("leaves the decision to the next poll when the instance ends while the tree is read again", async () => {
    // history level none: the instance that ended is gone from runtime and history
    let reads = 0
    const gone = engineError(404, "InvalidRequestException", "Process instance x does not exist")
    const engine = routed([
      [
        /^\/process-instance\/x$/,
        () => {
          reads += 1
          return reads === 1 ? { id: "x", definitionId: "parent:1:d" } : gone.clone()
        },
      ],
      [/^\/history\/process-instance\/x$/, () => gone.clone()],
      [/^\/process-instance$/, () => []],
      [/^\/job\/count$/, () => ({ count: 0 })],
      [/^\/process-instance\/count$/, () => ({ count: 0 })],
    ])
    const result = await waitAndInspect(depsOf(engine.fetch), { id: "x", known: true }, IDLE, VIEW)
    expect(result.view).toEqual({
      id: "x",
      state: "ENDED",
      waited: { until: "idle", elapsedMs: 250, polls: 2 },
    })
  })

  it("takes a cut tree as it is (instances beyond the cut are never counted)", async () => {
    const children = Array.from({ length: 101 }, (_, index) => ({
      id: `c${index}`,
      definitionId: "child:1:d",
    }))
    let calls = 0
    const engine = routed([
      [/^\/process-instance\/x$/, () => ({ id: "x", definitionId: "parent:1:d" })],
      [
        /^\/process-instance$/,
        (request) => {
          if (request.query.get("superProcessInstance") !== "x") return []
          // without a sort order the engine may answer in another order, and cut elsewhere
          calls += 1
          return [...children.slice(calls), ...children.slice(0, calls)]
        },
      ],
      [/^\/job\/count$/, () => ({ count: 0 })],
      ...RESTING,
    ])
    const deps = depsOf(engine.fetch)
    const result = await waitAndInspect(deps, { id: "x", known: true }, IDLE, VIEW)
    expect(result.view).toMatchObject({ truncated: true, waited: { until: "idle", polls: 1 } })
  })
})
