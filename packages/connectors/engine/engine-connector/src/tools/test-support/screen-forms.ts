/**
 * The JSON forms of version 1 as strict schemas: the engine, process and instance screens of
 * @miragon/pulse-screens (`ScreenFormat.JSON_VERSION`; a built board's is board-form.ts), every key
 * each form names and nothing else. Each schema's output
 * is held to the form's type by the compiler, and the forms of the conformance kit's fixed world and
 * of each dialect's recordings to the schema in screens.numbers.test.ts, so a tool's output that
 * parses here is the form a page knows by its version. A form that changes fails here first: a
 * change a reader of version 1 would misread takes the next version (the packages' READMEs say
 * which), and then this file describes it.
 */

import { z } from "zod"
import type {
  EngineScreenData,
  InstanceScreenData,
  ProcessScreenData,
} from "@miragon/pulse-screens"

export const count = z.number().int().min(0)
export const text = z.string()
export const id = z.string().min(1)

// The engine screen.

const engineInfo = z.strictObject({ product: text, version: text })

const processRow = z.strictObject({
  bpmnProcessId: id,
  name: text.optional(),
  latestVersion: z.number().int().min(1),
  running: count,
  withIncident: count,
  incidents: count,
  incidentsAtLeast: z.literal(true).optional(),
})

export const ENGINE_SCREEN_FORM: z.ZodType<EngineScreenData> = z.strictObject({
  engine: id,
  asOf: z.iso.datetime({ offset: true }),
  info: engineInfo.nullable(),
  processes: z.array(processRow),
  totals: z.strictObject({ processes: count, running: count, withIncident: count }),
})

// What the process and the instance screen share.

const definitionRef = z.strictObject({
  id,
  bpmnProcessId: id,
  version: z.number().int().min(1),
  name: text.optional(),
})

export const instanceState = z.enum(["running", "suspended", "completed", "terminated"])

const calledInstance = z.strictObject({
  id,
  bpmnProcessId: id,
  state: instanceState,
  withIncident: z.boolean(),
})

const callLink = z.union([
  z.strictObject({
    elementId: id,
    kind: z.literal("instances"),
    instances: z.array(calledInstance),
  }),
  z.strictObject({ elementId: id, kind: z.literal("definition"), definition: definitionRef }),
  z.strictObject({ elementId: id, kind: z.literal("missing"), bpmnProcessId: id }),
])

// The process screen.

export const PROCESS_SCREEN_FORM: z.ZodType<ProcessScreenData> = z.strictObject({
  engine: id,
  asOf: z.iso.datetime({ offset: true }),
  bpmnProcessId: id,
  selected: definitionRef.nullable(),
  versions: z.array(
    z.strictObject({ definition: definitionRef, running: count, withIncident: count }),
  ),
  badges: z.array(
    z.strictObject({
      elementId: id,
      running: count,
      incidents: count,
      incidentsInCalledInstances: count,
    }),
  ),
  calls: z.array(callLink),
  notices: z.array(
    z.strictObject({
      code: z.literal("olderVersionsRun"),
      running: count,
      withIncident: count,
      show: definitionRef,
    }),
  ),
  unread: z.array(z.enum(["diagram", "statistics", "calledProcesses"])),
})

// The instance screen.

const calledInstanceRef = z.strictObject({ instanceId: id, bpmnProcessId: id.optional() })

const headline = z.union([
  z.strictObject({
    code: z.literal("incident"),
    incidentId: id,
    elementId: id,
    since: text,
    suspended: z.boolean(),
  }),
  z.strictObject({
    code: z.literal("incidentInCalledInstance"),
    incidentId: id,
    elementId: id.nullable(),
    liesIn: calledInstanceRef,
    since: text,
    suspended: z.boolean(),
  }),
  z.strictObject({ code: z.literal("incidents"), count, suspended: z.boolean() }),
  z.strictObject({ code: z.literal("incidentsAtLeast"), count, suspended: z.boolean() }),
  z.strictObject({ code: z.literal("suspended") }),
  z.strictObject({ code: z.literal("ended"), state: z.enum(["completed", "terminated"]) }),
])

const incidentCard = z.strictObject({
  rootIncident: z.strictObject({ id, instanceId: id, definition: definitionRef }),
  liesIn: calledInstanceRef.nullable(),
  elementId: id,
  type: text,
  message: text,
  createdAt: text,
  retriesLeft: count.optional(),
  job: z.strictObject({ id, type: text.optional() }).optional(),
  text: z.enum(["stacktrace", "errorMessage"]).nullable(),
  rootCauseLine: text.nullable(),
  causeSource: z.enum(["stacktrace", "workerError", "errorMessage"]).nullable(),
})

const waitRow = z.strictObject({
  elementId: id,
  kind: z.enum([
    "userTask",
    "workerTask",
    "asyncContinuation",
    "timer",
    "message",
    "signal",
    "other",
  ]),
  elementName: text.optional(),
  since: text.optional(),
  dueAt: text.optional(),
  incidentId: id.optional(),
  assignee: text.optional(),
  taskType: text.optional(),
  retriesLeft: count.optional(),
  messageName: text.optional(),
  signalName: text.optional(),
  description: text.optional(),
  liesIn: calledInstanceRef.nullable(),
})

const pathRow = z.strictObject({
  elementId: id,
  elementName: text.optional(),
  startedAt: text,
  endedAt: text.optional(),
  state: z.enum(["active", "completed", "canceled"]),
  durationMs: count.optional(),
})

const variableRow = z.strictObject({
  name: text,
  valueJson: text,
  truncated: z.boolean(),
  scopeElementId: id.optional(),
  type: text.optional(),
  kind: z
    .enum(["string", "integer", "decimal", "boolean", "date", "json", "null", "opaque"])
    .optional(),
})

export const INSTANCE_SCREEN_FORM: z.ZodType<InstanceScreenData> = z.strictObject({
  engine: id,
  asOf: z.iso.datetime({ offset: true }),
  instance: z.strictObject({
    id,
    definition: definitionRef,
    state: instanceState,
    hasIncident: z.boolean(),
    businessKey: text.optional(),
    startedAt: text.optional(),
    endedAt: text.optional(),
  }),
  caller: z
    .strictObject({
      instanceId: id,
      found: z
        .strictObject({
          definition: definitionRef,
          state: instanceState,
          businessKey: text.optional(),
        })
        .nullable(),
    })
    .nullable(),
  headline: headline.nullable(),
  markers: z.array(
    z.strictObject({
      elementId: id,
      kind: z.enum(["completed", "waiting", "incident", "incidentInCalledInstance"]),
    }),
  ),
  calls: z.array(callLink),
  incidents: z.array(incidentCard),
  waits: z.array(waitRow),
  path: z.array(pathRow),
  variables: z.array(variableRow),
  truncated: z.boolean(),
  unread: z.array(z.enum(["diagram", "calledProcesses", "caller"])),
})
