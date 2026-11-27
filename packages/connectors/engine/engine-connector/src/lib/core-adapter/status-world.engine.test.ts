/**
 * c7-core's recorded status engines (`C7_STATUS_ENGINE`) hold on every Camunda 7 engine of the
 * family, not just on the Operaton 2.1.5 they were recorded from: the status world
 * (`seedC7StatusWorld`) seeded into two engines of the suite's image (`PULSE_ENGINE_IMAGE`,
 * Operaton 2.1.5 without one; CI runs Operaton and CIB seven; it skips on a Camunda 8 image), one
 * at history level FULL and one at NONE, gives through `engine_status`, the web app's verdict feed
 * and the chat overview's health feed, read live, the figures the recording expects of each: the
 * verdict, every count and every row's numbers, the copy at a call activity, the multi-instance
 * body's incident and the batch's incident outside any process alike, and the verdicts at the two
 * thresholds on the world's edge. Ids, instants, the engine's version and the engine's own texts
 * are each engine's own and stay out.
 *
 * `pnpm --fail-if-no-match --filter @miragon/pulse-engine-connector test:engines` (Docker).
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { C7_STATUS_ENGINE } from "@miragon/pulse-c7-core/testing"
import { engineImageOf } from "./engine-image.test-support.js"
import { judgedAt, statusServer, type StatusSurfaces } from "./status-surfaces.test-support.js"
import {
  seedStatusEngines,
  startStatusEngines,
  type StatusEngine,
  stopAll,
} from "./status-world.test-support.js"

const ENGINE_IMAGE = engineImageOf(process.env.PULSE_ENGINE_IMAGE)
const FLAVOR = ENGINE_IMAGE.dialect === "c7" ? ENGINE_IMAGE.flavor : "operaton"

interface Row {
  readonly [field: string]: unknown
}

interface StatusLike {
  readonly findings: readonly Row[]
  readonly definitions: readonly Row[]
  readonly incidents: readonly Row[]
  readonly [field: string]: unknown
}

interface HealthLike {
  readonly status: string
  readonly summary: Row
  readonly clusters: readonly Row[]
}

/** A row with only the fields `keep` names. */
const only = (row: Row, keep: readonly string[]) =>
  Object.fromEntries(keep.map((field) => [field, row[field]]))

/** What the status states of the engine, without ids, instants, versions and the engine's texts. */
function statusFigures(status: StatusLike) {
  const { findings, definitions, incidents } = status
  const counts = ["rootIncidentsTotal", "outsideAnyProcess", "incidentsTotal", "propagated"]
  return {
    ...only(status, [
      "status",
      ...counts,
      "externalTasks",
      "jobs",
      "tasks",
      "batches",
      "truncated",
    ]),
    findings: findings.map((row) => only(row, ["severity", "code"])),
    definitions,
    incidents: incidents.map((row) => ({
      ...only(row, ["processDefinitionKey", "activityId", "type", "count"]),
      instances: (row.processInstanceIds as readonly string[]).length,
    })),
  }
}

/** What the health states of the engine, its causes by their activity, type, counts and names. */
function healthFigures({ status, summary, clusters }: HealthLike) {
  const named = ["activityName", "processDefinitionKeys", "processDefinitionName"]
  const counted = ["incidentCount", "scannedIncidentCount"]
  return {
    status,
    summary,
    clusters: clusters.map((row) =>
      only(row, ["activityId", "incidentType", ...counted, ...named]),
    ),
  }
}

/** The figures of what each surface gives of one engine. */
function figures(surfaces: StatusSurfaces) {
  return {
    engineStatus: statusFigures(surfaces.engineStatus as StatusLike),
    verdict: surfaces.verdict,
    health: healthFigures(surfaces.health as HealthLike),
  }
}

describe.skipIf(ENGINE_IMAGE.dialect !== "c7")(
  `c7-core's recorded status engines on ${ENGINE_IMAGE.name}`,
  () => {
    let engines: StatusEngine[] = []

    beforeAll(async () => {
      engines = await startStatusEngines(ENGINE_IMAGE.name)
      await seedStatusEngines(engines)
    })

    afterAll(async () => {
      await stopAll(engines)
    })

    test("the status world gives the figures the recording expects at history levels full and none", async () => {
      const server = statusServer(engines, FLAVOR)
      const live = []
      for (const { engine } of engines) live.push(figures(await server.readAll(engine)))
      const recorded = C7_STATUS_ENGINE.engines.map(({ expected }) => figures(expected))
      expect(live).toEqual(recorded)
    })

    test("every surface turns at the recorded thresholds on the world's edge, full and none alike", async () => {
      const live = []
      for (const { engine, expected } of C7_STATUS_ENGINE.engines) {
        for (const { criticalIncidents } of expected.atEdges) {
          live.push(await judgedAt(engines, FLAVOR, engine, criticalIncidents))
        }
      }
      expect(live).toEqual(C7_STATUS_ENGINE.engines.flatMap(({ expected }) => expected.atEdges))
    })
  },
)
