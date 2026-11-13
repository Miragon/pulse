import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  InstanceId,
  type InstanceDetail,
  type WaitState,
} from "@miragon/pulse-engine-core"
import type { CliTarget } from "@miragon/pulse-runtime-view/ports"
import { describe, expect, test } from "vitest"
import { C7Adapter } from "../src/index.js"

const INSTANCE = "63d65e9e-cd7f-11f1-86d2-667bc3771e0d"
const DEFAULT_ENGINE: CliTarget = {
  kind: "endpoint",
  endpoint: "http://localhost:8080/engine-rest",
}
const ON_DEFAULT_ENGINE = "--url http://localhost:8080/engine-rest --auth none"

const KINDS = {
  userTask: { kind: "userTask" },
  workerTask: { kind: "workerTask", taskType: "ship-parcel" },
  asyncContinuation: { kind: "asyncContinuation" },
  timer: { kind: "timer" },
  message: { kind: "message", messageName: "ParcelReceived" },
  signal: { kind: "signal", signalName: "ProductRecall" },
  other: { kind: "other", description: "conditionalEvent" },
} as const

type Kind = keyof typeof KINDS

function waitAt(elementId: string, kind: Kind, instanceId = INSTANCE): WaitState {
  return { ...KINDS[kind], instanceId: InstanceId(instanceId), elementId: ElementId(elementId) }
}

function detailOf(waitStates: readonly WaitState[], instanceId = INSTANCE): InstanceDetail {
  return {
    instance: {
      id: InstanceId(instanceId),
      definition: {
        id: DefinitionId("return-handling:2:7a1c"),
        bpmnProcessId: BpmnProcessId("return-handling"),
        version: 2,
      },
      state: "running",
      hasIncident: false,
    },
    path: [],
    waitStates,
    incidents: [],
    calledInstances: [],
    variables: [],
    truncated: false,
  }
}

function commandFor(
  wait: WaitState,
  options: { target?: CliTarget; beside?: readonly WaitState[] } = {},
): string | undefined {
  const detail = detailOf([wait, ...(options.beside ?? [])], wait.instanceId)
  return new C7Adapter().cli(options.target ?? DEFAULT_ENGINE).triggerCommand(detail, wait)
}

describe("the CLI command that triggers the event a token of a C7 family engine waits for", () => {
  test.each(["message", "signal", "timer"] as const)(
    "advances a %s by its activity, the one wait state there",
    (kind) => {
      expect(commandFor(waitAt("Parcel", kind))).toBe(
        `pulse advance ${INSTANCE} --activity-id Parcel ${ON_DEFAULT_ENGINE}`,
      )
    },
  )

  test.each(["userTask", "workerTask", "asyncContinuation", "other"] as const)(
    "names no command for a %s, which waits for no event advance triggers",
    (kind) => {
      expect(commandFor(waitAt("Parcel", kind))).toBeUndefined()
    },
  )

  test("names the profile of the project file the editor reads the engine from with the editor's URL, which beats PULSE_CLI_URL", () => {
    const target: CliTarget = {
      kind: "profile",
      name: "shop-dev",
      endpoint: "http://127.0.0.1:18112/engine-rest",
    }
    expect(commandFor(waitAt("Window", "timer"), { target })).toBe(
      `pulse advance ${INSTANCE} --activity-id Window --profile shop-dev --url http://127.0.0.1:18112/engine-rest`,
    )
  })

  test("names the editor's default engine by --url with --auth none, so the CLI takes no profile or login", () => {
    const target: CliTarget = { kind: "endpoint", endpoint: "http://127.0.0.1:18090/engine-rest" }
    expect(commandFor(waitAt("Window", "timer"), { target })).toBe(
      `pulse advance ${INSTANCE} --activity-id Window --url http://127.0.0.1:18090/engine-rest --auth none`,
    )
  })

  test("quotes a word the shell would split or read, as the CLI's own ready commands do", () => {
    const wait = waitAt("Prüfung", "message", "return 'A' 7")
    const endpoint = "http://localhost:8080/shop%20engine/engine-rest"
    expect(commandFor(wait, { target: { kind: "profile", name: "shop dev", endpoint } })).toBe(
      `pulse advance 'return '\\''A'\\'' 7' --activity-id 'Prüfung' --profile 'shop dev' --url '${endpoint}'`,
    )
    expect(commandFor(waitAt("Parcel", "signal"), { target: { kind: "endpoint", endpoint } })).toBe(
      `pulse advance ${INSTANCE} --activity-id Parcel --url '${endpoint}' --auth none`,
    )
  })

  test("names no command when another wait state of the instance tree waits at the same activity", () => {
    const sibling = waitAt("Parcel", "message")
    const called = waitAt("Parcel", "message", "called-1")
    expect(commandFor(waitAt("Parcel", "message"), { beside: [sibling] })).toBeUndefined()
    expect(commandFor(waitAt("Parcel", "message"), { beside: [called] })).toBeUndefined()
    expect(commandFor(waitAt("Parcel", "message"), { beside: [waitAt("Window", "timer")] })).toBe(
      `pulse advance ${INSTANCE} --activity-id Parcel ${ON_DEFAULT_ENGINE}`,
    )
  })
})
