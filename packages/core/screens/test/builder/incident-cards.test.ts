import { BpmnProcessId, InstanceId, type IncidentDetails } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { InstanceScreen, ScreenJson } from "../../src/builder/index.js"
import { Instances } from "./support/instances.js"

const STACKTRACE = Instances.incident("stacktrace", {
  details: Instances.complete("stacktrace", "MissingBean: no bean"),
})
const WORKER = Instances.incident("worker", {
  job: { id: "job-1", type: "charge-card" },
  details: Instances.complete("errorMessage", "Card declined"),
})
const ENGINE = Instances.incident("engine", {
  details: Instances.complete("errorMessage", "No variable customerId"),
})
const NONE = Instances.incident("none")
const WORKER_WAIT = Instances.wait({
  kind: "workerTask",
  taskType: "charge-card",
  incidentId: WORKER.id,
})

function cardsOf(
  changes: Parameters<typeof Instances.detail>[0],
  fullDetails?: ReadonlyMap<string, IncidentDetails>,
) {
  const facts = Instances.facts(Instances.detail(changes), {
    ...(fullDetails === undefined ? {} : { fullDetails: fullDetails as never }),
  })
  return ScreenJson.instance(InstanceScreen.of(facts)).incidents
}

describe("the incident cards of an instance", () => {
  test("show each root incident of the tree in the order the engine gives them", () => {
    const down = Instances.incident("down", { instanceId: Instances.CHILD })

    const cards = cardsOf({ ...Instances.chain(), incidents: [STACKTRACE, down] })

    expect(cards.map(({ rootIncident }) => rootIncident.id)).toEqual(["stacktrace", "down"])
    expect(cards.map(({ rootIncident }) => rootIncident.instanceId)).toEqual([
      Instances.ROOT,
      Instances.CHILD,
    ])
  })

  test("say where a root incident of a called instance lies, never for one of the instance itself", () => {
    const down = Instances.incident("down", {
      instanceId: Instances.GRANDCHILD,
      definition: Instances.SCORING,
    })

    const [own, called] = cardsOf({ ...Instances.chain(), incidents: [NONE, down] })

    expect(own?.liesIn).toBeNull()
    expect(called?.liesIn).toEqual({ instanceId: Instances.GRANDCHILD, bpmnProcessId: "bureau" })
    expect(called?.rootIncident.definition).toEqual({
      id: "scoring:3",
      bpmnProcessId: "scoring",
      version: 3,
    })
  })

  test("name the instance an incident lies in without its process where the tree lacks it", () => {
    const lost = InstanceId("lost")

    const [card] = cardsOf({ incidents: [Instances.incident("lost", { instanceId: lost })] })

    expect(card?.liesIn).toEqual({ instanceId: "lost" })
  })

  test("keep the root cause line apart from the root incident, by the source of its text", () => {
    const cards = cardsOf({
      incidents: [STACKTRACE, WORKER, ENGINE, NONE],
      waitStates: [Instances.wait({ kind: "userTask" }), WORKER_WAIT],
    })

    expect(cards.map((card) => [card.text, card.causeSource, card.rootCauseLine])).toEqual([
      ["stacktrace", "stacktrace", "MissingBean: no bean"],
      ["errorMessage", "workerError", "Card declined"],
      ["errorMessage", "errorMessage", "No variable customerId"],
      [null, null, null],
    ])
  })

  test("name a worker's error only where the incident stops a worker task, never by its job", () => {
    const failedJob = Instances.incident("failed-job", {
      job: { id: "job-3" },
      details: Instances.complete("errorMessage", "Connection refused"),
    })
    const unlinked = Instances.incident("unlinked", {
      job: { id: "job-4", type: "charge-card" },
      details: Instances.complete("errorMessage", "Card declined"),
    })

    const cards = cardsOf({
      incidents: [failedJob, unlinked],
      waitStates: [
        Instances.wait({ kind: "asyncContinuation", retriesLeft: 0, incidentId: failedJob.id }),
        Instances.wait({ kind: "workerTask", taskType: "charge-card" }),
      ],
    })

    expect(cards.map((card) => card.causeSource)).toEqual(["errorMessage", "errorMessage"])
  })

  test("take the root cause line from complete details only, the read ones before the shortened", () => {
    const shortened = Instances.incident("shortened", {
      details: { kind: "errorMessage", text: "Wrapper: outer", truncated: true, rootCause: "x" },
    })
    const unread = Instances.incident("unread", {
      details: { kind: "stacktrace", text: "Wrapper: outer", truncated: true, rootCause: "y" },
    })
    const complete = new Map([[shortened.id, Instances.complete("stacktrace", "Inner: real")]])

    const cards = cardsOf({ incidents: [shortened, unread] }, complete)

    expect(cards.map((card) => [card.text, card.causeSource, card.rootCauseLine])).toEqual([
      ["errorMessage", "stacktrace", "Inner: real"],
      ["stacktrace", null, null],
    ])
  })

  test("leave the cause out where complete details name no root cause", () => {
    const blank = Instances.incident("blank", {
      details: { kind: "stacktrace", text: "", truncated: false },
    })

    const [card] = cardsOf({ incidents: [blank] })

    expect(card).toMatchObject({ text: "stacktrace", causeSource: null, rootCauseLine: null })
  })

  test("carry the engine's type, message, time, retries and job, the job's type where it has one", () => {
    const cards = cardsOf({
      incidents: [
        Instances.incident("a", {
          type: "failedExternalTask",
          message: "Card declined",
          retriesLeft: 0,
          job: { id: "task-1", type: "charge-card" },
        }),
        Instances.incident("b", { job: { id: "job-2" } }),
      ],
    })

    expect(cards[0]).toMatchObject({
      elementId: "Activity_Wait",
      type: "failedExternalTask",
      message: "Card declined",
      createdAt: Instances.SINCE,
      retriesLeft: 0,
      job: { id: "task-1", type: "charge-card" },
    })
    expect(cards[1]?.job).toStrictEqual({ id: "job-2" })
    expect(cards[1]).not.toHaveProperty("retriesLeft")
    expect(BpmnProcessId("order")).toBe(cards[1]?.rootIncident.definition.bpmnProcessId)
  })
})
