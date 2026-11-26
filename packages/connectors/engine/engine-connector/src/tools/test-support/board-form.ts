/**
 * A built board's JSON form of version 1 (`BoardVocabulary.JSON_VERSION` of @miragon/pulse-board)
 * as a strict schema, as screen-forms.ts holds the screens': every key the form names and nothing
 * else, its output held to `BoardData` by the compiler.
 */

import { z } from "zod"
import type { BoardData } from "@miragon/pulse-board"
import { count, id, instanceState, text } from "./screen-forms.js"

const problem = z.union([
  z.strictObject({
    path: text,
    code: z.enum([
      "notJson",
      "notAnObject",
      "notAList",
      "missing",
      "ignoredKey",
      "schemaNotText",
      "blankText",
      "engineNames",
      "tenantIds",
      "diagramOnOneEngine",
      "notWholeNumber",
      "noColumns",
      "notBoolean",
      "elementWithoutProcess",
      "elementOnEnded",
      "endedWithIncident",
      "tenantsNotRead",
    ]),
  }),
  z.strictObject({
    path: text,
    code: z.enum(["unknownKey", "notOneOf", "variableColumn"]),
    values: z.strictObject({ choices: z.array(text) }),
  }),
  z.strictObject({
    path: text,
    code: z.literal("unknownVersion"),
    values: z.strictObject({ found: text, reads: z.number() }),
  }),
  z.strictObject({
    path: text,
    code: z.literal("engineOutsideBoard"),
    values: z.strictObject({ engines: z.array(text) }),
  }),
  z.strictObject({
    path: text,
    code: z.literal("tooManyWidgets"),
    values: z.strictObject({ position: count, max: count }),
  }),
  z.strictObject({
    path: text,
    code: z.literal("diagramTooLong"),
    values: z.strictObject({ title: text, engine: text }),
  }),
])

const boardEngine = z.union([
  z.strictObject({ name: id, state: z.literal("notConfigured") }),
  z.strictObject({
    name: id,
    state: z.literal("failed"),
    failure: z.strictObject({ code: id, message: text.optional() }),
  }),
  z.strictObject({
    name: id,
    state: z.literal("ready"),
    product: text,
    version: text,
    totals: z.strictObject({ running: count, withIncident: count }).optional(),
  }),
])

const countData = z.strictObject({ count, atLeast: z.literal(true).optional() })

const definition = z.strictObject({
  id,
  bpmnProcessId: id,
  version: z.number().int().min(1),
  name: text.optional(),
})

const filter = z.strictObject({
  process: id.optional(),
  activeElement: id.optional(),
  state: z.enum(["running", "ended"]),
  withIncident: z.boolean().optional(),
  businessKey: text.optional(),
})

const widgetBase = { title: text.optional(), engines: z.array(id) }

const counterTile = z.strictObject({
  kind: z.literal("counter"),
  widget: z.strictObject({
    ...widgetBase,
    widget: z.literal("counter"),
    filter,
    warnAbove: z.number().optional(),
  }),
  readings: z.array(
    z.strictObject({
      engine: id,
      count: countData.optional(),
      above: z.literal(true).optional(),
      undecided: z.literal(true).optional(),
    }),
  ),
  known: count,
  total: countData.optional(),
})

const instanceListTile = z.strictObject({
  kind: z.literal("instanceList"),
  widget: z.strictObject({
    ...widgetBase,
    widget: z.literal("instanceList"),
    filter,
    columns: z.array(
      z.enum([
        "engine",
        "process",
        "version",
        "businessKey",
        "state",
        "startedAt",
        "endedAt",
        "incident",
      ]),
    ),
  }),
  groups: z.array(
    z.strictObject({
      engine: id,
      instances: z
        .array(
          z.strictObject({
            id,
            definition,
            state: instanceState,
            hasIncident: z.boolean(),
            businessKey: text.optional(),
            startedAt: text.optional(),
            endedAt: text.optional(),
          }),
        )
        .optional(),
      total: countData.optional(),
    }),
  ),
})

const incidentSummaryTile = z.strictObject({
  kind: z.literal("incidentSummary"),
  widget: z.strictObject({
    ...widgetBase,
    widget: z.literal("incidentSummary"),
    groupBy: z.enum(["engine", "process"]),
  }),
  engines: count,
  known: count,
  total: count.optional(),
  rows: z.array(
    z.strictObject({ engine: id, process: definition.optional(), withIncident: count.optional() }),
  ),
})

const processDiagramTile = z.strictObject({
  kind: z.literal("processDiagram"),
  widget: z.strictObject({ ...widgetBase, widget: z.literal("processDiagram"), process: id }),
  engine: id,
  latest: definition.optional(),
  notDeployed: z.literal(true).optional(),
  badges: z
    .array(
      z.strictObject({
        elementId: id,
        active: count,
        incidents: count,
        incidentsInCalledInstances: count,
      }),
    )
    .optional(),
})

const incidentListTile = z.strictObject({
  kind: z.literal("incidentList"),
  widget: z.strictObject({
    ...widgetBase,
    widget: z.literal("incidentList"),
    process: id.optional(),
  }),
  groups: z.array(
    z.strictObject({
      engine: id,
      incidents: z
        .array(
          z.strictObject({
            id,
            instanceId: id,
            definition,
            elementId: id,
            type: text,
            message: text,
            createdAt: text,
          }),
        )
        .optional(),
      more: z.literal(true).optional(),
    }),
  ),
})

const refusedTile = z.strictObject({
  kind: z.literal("refused"),
  widget: text.optional(),
  title: text.optional(),
  problems: z.array(problem),
})

export const BOARD_FORM: z.ZodType<BoardData> = z.strictObject({
  title: text,
  engines: z.array(boardEngine),
  rows: z.array(
    z.array(
      z.union([
        counterTile,
        instanceListTile,
        incidentSummaryTile,
        processDiagramTile,
        incidentListTile,
        refusedTile,
      ]),
    ),
  ),
  notes: z.array(problem),
})
