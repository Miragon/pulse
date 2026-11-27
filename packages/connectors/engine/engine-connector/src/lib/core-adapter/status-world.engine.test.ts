/**
 * c7-core's recorded status engines (`C7_STATUS_ENGINE`) hold on every Camunda 7 engine of the
 * family, not just on the Operaton 2.1.5 they were recorded from: the status world
 * (`seedC7StatusWorld`) seeded into two engines of the suite's image (`PULSE_ENGINE_IMAGE`,
 * Operaton 2.1.5 without one; CI runs Operaton and CIB seven; it skips on a Camunda 8 image), one
 * at history level FULL and one at NONE, gives through `engine_status`, the web app's verdict feed
 * and the chat overview's health feed, read live, the figures the recording expects of each: the
 * verdict, every count and every row's numbers, the copy at a call activity, the multi-instance
 * body's incident and the batch's incident outside any process alike, and the verdicts at the two
 * thresholds on the world's edge; and the engine at FULL gives through the process screen's, the
 * instance screen's and the board's feeds the figures of the status world's recorded screens
 * (`C7_STATUS_SCREENS`), the body's root incident on the element it repeats. Ids, instants, the
 * engine's version and the engine's own texts are each engine's own and stay out.
 *
 * `pnpm --fail-if-no-match --filter @miragon/pulse-engine-connector test:engines` (Docker).
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest"
import type { BoardData } from "@miragon/pulse-board"
import { BoardFigures } from "@miragon/pulse-board/testing"
import {
  C7_STATUS_ENGINE,
  C7_STATUS_SCREENS,
  type C7ExpectedStatusScreens,
  type C7StatusWorldIds,
} from "@miragon/pulse-c7-core/testing"
import type { InstanceScreenData, ProcessScreenData } from "@miragon/pulse-screens"
import { ScreenFigures } from "@miragon/pulse-screens/testing"
import { engineImageOf } from "./engine-image.test-support.js"
import { readStatusScreens } from "./status-screens.test-support.js"
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

/** The figures of the status world's screens, without ids and instants. */
function screenFigures({ process, instance, board }: C7ExpectedStatusScreens) {
  return {
    process: ScreenFigures.process(process as ProcessScreenData),
    instance: ScreenFigures.instance(instance as InstanceScreenData),
    board: BoardFigures.of(board as BoardData),
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
    let ids: C7StatusWorldIds[] = []

    beforeAll(async () => {
      engines = await startStatusEngines(ENGINE_IMAGE.name)
      ids = await seedStatusEngines(engines)
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

    test("the screens at full give the recorded figures, the body's incident on its element", async () => {
      const [full] = engines
      const [fullIds] = ids
      if (full === undefined || fullIds === undefined) throw new Error("no engine at full")
      const live = await readStatusScreens(
        { engine: full.engine, url: full.url, flavor: FLAVOR },
        C7_STATUS_SCREENS.text,
        fullIds.instanceIds.failing,
      )
      expect(screenFigures(live)).toEqual(screenFigures(C7_STATUS_SCREENS.expected))
    })
  },
)
