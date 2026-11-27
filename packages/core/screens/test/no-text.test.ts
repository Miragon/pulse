import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  InstanceId,
  type InstanceDetail,
} from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import {
  EngineScreen,
  Finder,
  InstanceList,
  InstanceScreen,
  ProcessScreen,
  ScreenJson,
} from "../src/builder/index.js"
import {
  FleetSums,
  type CallLinkKind,
  type CauseSourceCode,
  type HeadlineCode,
  type InstanceScopeCode,
  type IncidentTextKind,
  type InstanceReadCode,
  type InstanceStateCode,
  type MarkerKindCode,
  type PathStateCode,
  type ProcessNoticeCode,
  type ProcessReadCode,
  type ValueKindCode,
  type VariableConditionKindCode,
  type WaitKindCode,
} from "../src/index.js"
import { WORLD_SCREENS } from "../src/testing/index.js"
import { Instances } from "./builder/support/instances.js"
import { ScreenWorld } from "./builder/support/world.js"

type FieldKind = "id" | "time" | "engineWord" | "code"

const STRING_FIELDS: Readonly<Record<string, FieldKind>> = {
  engine: "id",
  bpmnProcessId: "id",
  id: "id",
  instanceId: "id",
  incidentId: "id",
  definitionId: "id",
  next: "id",
  elementId: "id",
  scopeElementId: "id",
  asOf: "time",
  startedAt: "time",
  endedAt: "time",
  createdAt: "time",
  since: "time",
  dueAt: "time",
  name: "engineWord",
  product: "engineWord",
  version: "engineWord",
  businessKey: "engineWord",
  elementName: "engineWord",
  type: "engineWord",
  message: "engineWord",
  rootCauseLine: "engineWord",
  assignee: "engineWord",
  taskType: "engineWord",
  messageName: "engineWord",
  signalName: "engineWord",
  description: "engineWord",
  valueJson: "engineWord",
  state: "code",
  code: "code",
  kind: "code",
  text: "code",
  causeSource: "code",
  unread: "code",
  atLeast: "code",
  refusedVariableConditions: "code",
}

const CODES: ReadonlySet<string> = new Set<
  | InstanceStateCode
  | PathStateCode
  | HeadlineCode
  | MarkerKindCode
  | WaitKindCode
  | CallLinkKind
  | ValueKindCode
  | IncidentTextKind
  | CauseSourceCode
  | InstanceReadCode
  | ProcessReadCode
  | ProcessNoticeCode
  | InstanceScopeCode
  | VariableConditionKindCode
>([
  ...(["running", "suspended", "completed", "terminated", "active", "canceled"] as const),
  ...([
    "incident",
    "incidentInCalledInstance",
    "incidents",
    "incidentsAtLeast",
    "ended",
    "waiting",
  ] as const),
  ...([
    "userTask",
    "workerTask",
    "asyncContinuation",
    "timer",
    "message",
    "signal",
    "other",
  ] as const),
  ...(["instances", "definition", "missing"] as const),
  ...(["string", "integer", "decimal", "boolean", "date", "json", "null", "opaque"] as const),
  ...([
    "stacktrace",
    "errorMessage",
    "workerError",
    "diagram",
    "calledProcesses",
    "caller",
  ] as const),
  ...(["statistics", "olderVersionsRun", "withIncident", "all", "ordering", "date"] as const),
])

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

interface StringField {
  readonly path: string
  readonly key: string
  readonly value: string
}

class FormWalk {
  static strings(value: unknown, path = "$", key = ""): StringField[] {
    if (typeof value === "string") {
      return [{ path, key, value }]
    }
    if (Array.isArray(value)) {
      return value.flatMap((entry: unknown, index) =>
        FormWalk.strings(entry, `${path}[${String(index)}]`, key),
      )
    }
    if (value !== null && typeof value === "object") {
      return Object.entries(value).flatMap(([name, entry]) =>
        FormWalk.strings(entry, `${path}.${name}`, name),
      )
    }
    return []
  }

  static findings(form: unknown, engineWords: ReadonlySet<string>): string[] {
    return FormWalk.strings(form).flatMap((field) => {
      const kind = STRING_FIELDS[field.key]
      if (kind === undefined) {
        return [`${field.path}: "${field.value}" is text of its own`]
      }
      return FormWalk.fits(kind, field.value, engineWords) ? [] : [`${field.path}: no ${kind}`]
    })
  }

  private static fits(kind: FieldKind, value: string, engineWords: ReadonlySet<string>): boolean {
    switch (kind) {
      case "id":
        return /^\S+$/.test(value)
      case "time":
        return ISO_TIME.test(value) && new Date(value).toISOString() === value
      case "engineWord":
        return engineWords.has(value)
      case "code":
        return CODES.has(value)
    }
  }
}

async function worldForms(): Promise<{ readonly forms: unknown[]; readonly words: Set<string> }> {
  const runtime = ScreenWorld.world()
  const definitions = await runtime.listDefinitions()
  const info = await runtime.describeEngine()
  const screen = ScreenJson.engine(
    await EngineScreen.read("prod-a", runtime, () => ScreenWorld.AS_OF),
  )
  const bare = ScreenJson.engine(
    EngineScreen.of({
      engine: "prod-b",
      asOf: ScreenWorld.AS_OF,
      definitions: [ScreenWorld.summary("audit", { running: 1, withIncident: 0 })],
      info: undefined,
    }),
  )
  const words = new Set([
    info.product,
    info.version,
    ...definitions.flatMap(({ latest }) => (latest.name === undefined ? [] : [latest.name])),
  ])
  const instances = await instanceForms()
  const processes = await processForms()
  return {
    forms: [
      screen,
      bare,
      WORLD_SCREENS.engine,
      FleetSums.of([screen, bare]),
      ...instances.forms,
      ...processes,
      ...(await findForms()),
    ],
    words: new Set([...words, ...instances.words]),
  }
}

function stringsOf(value: unknown): string[] {
  return FormWalk.strings(value).map(({ value: text }) => text)
}

const RICH: InstanceDetail = Instances.detail({
  instance: Instances.summary({ businessKey: "ORD-1", state: "suspended" }),
  ...Instances.chain(),
  incidents: [
    Instances.incident("a", {
      instanceId: Instances.GRANDCHILD,
      job: { id: "job-1", type: "charge-card" },
      details: Instances.complete("errorMessage", "Card declined"),
    }),
    Instances.incident("b", { details: Instances.complete("stacktrace", "MissingBean: no bean") }),
  ],
  waitStates: [
    Instances.wait({ kind: "workerTask", taskType: "charge-card", incidentId: "a" } as never),
    Instances.wait({
      kind: "message",
      messageName: "Paid",
      elementName: "Wait for payment",
    } as never),
    Instances.wait({ kind: "other", description: "conditionalEvent" }),
  ],
  path: [
    {
      elementId: ElementId("Event_Start"),
      elementName: "Start",
      startedAt: Instances.SINCE,
      endedAt: Instances.SINCE,
      canceled: false,
    },
  ],
  variables: [
    {
      name: "note",
      scope: { kind: "element", elementId: Instances.ELEMENT },
      valueJson: '"long"',
      truncated: true,
      type: "String",
      kind: "string",
    },
  ],
})

async function findForms(): Promise<unknown[]> {
  const gap = ScreenWorld.world({ countInstances: () => Promise.resolve({ count: 1 }) })
  const read = (text: string, runtime = ScreenWorld.world()) =>
    Finder.read("prod-a", text, runtime, () => ScreenWorld.AS_OF).then((model) =>
      ScreenJson.find(model),
    )
  return [
    await read("ORD-1003"),
    await read("fake-label-of-DSP-3001"),
    await read("ORD-1003", gap),
    WORLD_SCREENS.find,
    WORLD_SCREENS.findById,
  ]
}

async function processForms(): Promise<unknown[]> {
  const runtime = ScreenWorld.world({
    countInstances: () => Promise.resolve({ count: 1000, atLeast: true }),
    refusedVariableConditions: () => ["ordering", "date"],
  })
  const read = (bpmnProcessId: string) =>
    ProcessScreen.read(
      "prod-a",
      { bpmnProcessId: BpmnProcessId(bpmnProcessId), tenantId: null },
      runtime,
      () => ScreenWorld.AS_OF,
    )
  const [order, dispatch, unread] = await Promise.all([
    read("pulse-order"),
    read("pulse-dispatch"),
    ProcessScreen.read(
      "prod-a",
      { bpmnProcessId: BpmnProcessId("pulse-dispatch"), tenantId: null },
      ScreenWorld.world({
        getDiagramXml: () => Promise.resolve(undefined),
        getElementStatistics: () => Promise.reject(new Error("down")),
        getCalledProcesses: () => Promise.reject(new Error("down")),
      }),
      () => ScreenWorld.AS_OF,
    ),
  ])
  const list = await InstanceList.read(
    "prod-a",
    { definitionId: DefinitionId("pulse-order:1"), filter: { scope: "all" } },
    runtime,
    () => ScreenWorld.AS_OF,
  )
  return [
    ...[order, dispatch, unread].map((model) =>
      model === undefined ? {} : ScreenJson.process(model),
    ),
    ScreenJson.instanceList(list),
    WORLD_SCREENS.process,
    WORLD_SCREENS.olderVersion,
    WORLD_SCREENS.callingProcess,
    WORLD_SCREENS.instanceList,
  ]
}

async function instanceForms(): Promise<{ readonly forms: unknown[]; readonly words: string[] }> {
  const runtime = ScreenWorld.world()
  const ids = [WORLD_SCREENS.instance.instance.id, WORLD_SCREENS.calledInstance.instance.id]
  const read = await Promise.all(
    ids.map((id) =>
      InstanceScreen.read("prod-a", InstanceId(id), runtime, () => ScreenWorld.AS_OF),
    ),
  )
  const details = await Promise.all(ids.map((id) => runtime.getInstanceDetail(InstanceId(id))))
  const callers = await runtime.searchInstances({}, { limit: 50 })
  const rich = ScreenJson.instance(InstanceScreen.of(Instances.facts(RICH)))
  return {
    forms: [
      ...read.map((model) => (model === undefined ? {} : ScreenJson.instance(model))),
      WORLD_SCREENS.instance,
      WORLD_SCREENS.calledInstance,
      rich,
    ],
    words: [...stringsOf(details), ...stringsOf(callers), ...stringsOf(RICH)],
  }
}

describe("the screens' JSON forms", () => {
  test("hold no text of their own: every text is an id, a time or a word the engine gave", async () => {
    const { forms, words } = await worldForms()

    expect(forms.flatMap((form) => FormWalk.findings(form, words))).toEqual([])
    expect(forms.flatMap((form) => FormWalk.strings(form)).length).toBeGreaterThan(200)
  })

  test("are held to it by a walk that finds a planted text, a wrong time and a word no engine gave", async () => {
    const { words } = await worldForms()
    const planted = {
      engine: "prod-a",
      asOf: "2026-11-19 09:00",
      info: { product: "Unknown engine", version: "1.0.0" },
      summary: "3 processes · 5 running",
      processes: [{ bpmnProcessId: "with space" }],
      headline: { code: "Waiting at an incident", title: "Waiting" },
    }

    expect(FormWalk.findings(planted, words)).toEqual([
      "$.asOf: no time",
      "$.info.product: no engineWord",
      '$.summary: "3 processes · 5 running" is text of its own',
      "$.processes[0].bpmnProcessId: no id",
      "$.headline.code: no code",
      '$.headline.title: "Waiting" is text of its own',
    ])
  })
})
